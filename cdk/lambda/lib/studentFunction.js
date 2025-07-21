const { initializeConnection } = require("./lib.js");
let { SM_DB_CREDENTIALS, RDS_PROXY_ENDPOINT, USER_POOL } = process.env;
const {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} = require("@aws-sdk/client-cognito-identity-provider");

// SQL conneciton from global variable at lib.js
let sqlConnection = global.sqlConnection;

exports.handler = async (event) => {
  const cognito_id = event.requestContext.authorizer.userId;
  const client = new CognitoIdentityProviderClient();
  const userAttributesCommand = new AdminGetUserCommand({
    UserPoolId: USER_POOL,
    Username: cognito_id,
  });
  const userAttributesResponse = await client.send(userAttributesCommand);

  const emailAttr = userAttributesResponse.UserAttributes.find(
    (attr) => attr.Name === "email"
  );
  const userEmailAttribute = emailAttr ? emailAttr.Value : null;
  // Check for query string parameters

  const queryStringParams = event.queryStringParameters || {};
  const queryEmail = queryStringParams.email;
  const studentEmail = queryStringParams.student_email;
  const userEmail = queryStringParams.user_email;

  const isUnauthorized =
    (queryEmail && queryEmail !== userEmailAttribute) ||
    (studentEmail && studentEmail !== userEmailAttribute) ||
    (userEmail && userEmail !== userEmailAttribute);

  if (isUnauthorized) {
    return {
      statusCode: 401,
      headers: {
        "Access-Control-Allow-Headers":
          "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "*",
      },
      body: JSON.stringify({ error: "Unauthorized" }),
    };
  }

  const response = {
    statusCode: 200,
    headers: {
      "Access-Control-Allow-Headers":
        "Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "*",
    },
    body: "",
  };

  // Initialize the database connection if not already initialized
  if (!sqlConnection) {
    await initializeConnection(SM_DB_CREDENTIALS, RDS_PROXY_ENDPOINT);
    sqlConnection = global.sqlConnection;
  }

  // Function to format student full names (lowercase and spaces replaced with "_")
  const formatNames = (name) => {
    return name.toLowerCase().replace(/\s+/g, "_");
  };

  let data;
  try {
    const pathData = event.httpMethod + " " + event.resource;
    switch (pathData) {
      case "POST /student/create_user":
        if (event.queryStringParameters) {
          const {
            user_email,
            username,
            first_name,
            last_name,
            preferred_name,
          } = event.queryStringParameters;

          try {
            // Check if the user already exists
            const existingUser = await sqlConnection`
                SELECT * FROM "users"
                WHERE user_email = ${user_email};
            `;

            if (existingUser.length > 0) {
              // Update the existing user's information
              const updatedUser = await sqlConnection`
                    UPDATE "users"
                    SET
                        username = ${username},
                        first_name = ${first_name},
                        last_name = ${last_name},
                        last_sign_in = CURRENT_TIMESTAMP,
                        time_account_created = CURRENT_TIMESTAMP
                    WHERE user_email = ${user_email}
                    RETURNING *;
                `;
              response.body = JSON.stringify(updatedUser[0]);
            } else {
              // Insert a new user with 'student' role
              const newUser = await sqlConnection`
                    INSERT INTO "users" (user_email, username, first_name, last_name, time_account_created, roles, last_sign_in)
                    VALUES (${user_email}, ${username}, ${first_name}, ${last_name}, CURRENT_TIMESTAMP, ARRAY['student'], CURRENT_TIMESTAMP)
                    RETURNING *;
                `;
              response.body = JSON.stringify(newUser[0]);
            }
          } catch (err) {
            response.statusCode = 500;
            console.log(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({ error: "User data is required" });
        }
        break;
      case "GET /student/get_user_roles":
        if (
          event.queryStringParameters &&
          event.queryStringParameters.user_email
        ) {
          const user_email = event.queryStringParameters.user_email;
          try {
            // Retrieve roles for the user with the provided email
            const userData = await sqlConnection`
                SELECT roles
                FROM "users"
                WHERE user_email = ${user_email};
              `;
            if (userData.length > 0) {
              response.body = JSON.stringify({ roles: userData[0].roles });
            } else {
              response.statusCode = 404;
              response.body = JSON.stringify({ error: "User not found" });
            }
          } catch (err) {
            response.statusCode = 500;
            console.log(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({ error: "User email is required" });
        }
        break;
      case "GET /student/get_name":
        if (
          event.queryStringParameters &&
          event.queryStringParameters.user_email
        ) {
          const user_email = event.queryStringParameters.user_email;
          try {
            // Retrieve roles for the user with the provided email
            const userData = await sqlConnection`
                  SELECT first_name
                  FROM "users"
                  WHERE user_email = ${user_email};
                `;
            if (userData.length > 0) {
              response.body = JSON.stringify({ name: userData[0].first_name });
            } else {
              response.statusCode = 404;
              response.body = JSON.stringify({ error: "User not found" });
            }
          } catch (err) {
            response.statusCode = 500;
            console.log(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({ error: "User email is required" });
        }
        break;
      case "GET /student/simulation_group":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.email
        ) {
          const user_email = event.queryStringParameters.email;

          try {
            // Retrieve the user ID using the user_email
            const userResult = await sqlConnection`
                SELECT user_id FROM "users" WHERE user_email = ${user_email};
              `;

            if (userResult.length === 0) {
              response.statusCode = 404;
              response.body = JSON.stringify({ error: "User not found" });
              break;
            }

            const user_id = userResult[0].user_id;

            // Query to get simulation groups for the user
            const data = await sqlConnection`
                SELECT "simulation_groups".*
                FROM "enrolments"
                JOIN "simulation_groups" ON "simulation_groups".simulation_group_id = "enrolments".simulation_group_id
                WHERE "enrolments".user_id = ${user_id}
                AND "simulation_groups".group_student_access = TRUE
                ORDER BY "simulation_groups".group_name, "simulation_groups".simulation_group_id;
              `;
            response.body = JSON.stringify(data);
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = "Invalid value";
        }
        break;
      case "GET /student/simulation_group_page":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.email &&
          event.queryStringParameters.simulation_group_id
        ) {
          const studentEmail = event.queryStringParameters.email;
          const simulationGroupId = event.queryStringParameters.simulation_group_id;
    
          try {
            // Retrieve the user ID using the user_email
            const userResult = await sqlConnection`
                SELECT user_id FROM "users" WHERE user_email = ${studentEmail};
              `;
    
            if (userResult.length === 0) {
              response.statusCode = 404;
              response.body = JSON.stringify({ error: "User not found" });
              break;
            }
    
            const userId = userResult[0].user_id;
    
            // Fetch patient data associated with the simulation group
            const data = await sqlConnection`
                WITH StudentEnrollment AS (
                  SELECT 
                    enrolment_id
                  FROM 
                    "enrolments"
                  WHERE 
                    user_id = ${userId}
                    AND simulation_group_id = ${simulationGroupId}
                  LIMIT 1
                )
                SELECT
                  p.patient_id,
                  p.patient_name,
                  p.patient_age,
                  p.patient_gender,
                  p.patient_number,
                  p.llm_completion,
                  sp.student_interaction_id,
                  sp.patient_score,
                  sp.last_accessed,
                  sp.patient_context_embedding,
                  sp.is_completed
                FROM
                  "patients" p
                LEFT JOIN
                  "student_interactions" sp ON sp.patient_id = p.patient_id
                JOIN
                  StudentEnrollment se ON sp.enrolment_id = se.enrolment_id
                WHERE
                  p.simulation_group_id = ${simulationGroupId}
                ORDER BY
                  p.patient_number;
              `;
    
            const enrolmentId = data[0]?.enrolment_id;
    
            if (enrolmentId) {
              await sqlConnection`
                  INSERT INTO "user_engagement_log" (
                    log_id, user_id, simulation_group_id, patient_id, enrolment_id, timestamp, engagement_type
                  ) VALUES (
                    uuid_generate_v4(), ${userId}, ${simulationGroupId}, null, ${enrolmentId}, CURRENT_TIMESTAMP, 'group access'
                  );
                `;
            }
    
            response.body = JSON.stringify(data);
          } catch (err) {
            response.statusCode = 500;
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = "Invalid value";
        }
        break;
      case "GET /student/patient":
        if (
            event.queryStringParameters != null &&
            event.queryStringParameters.email &&
            event.queryStringParameters.simulation_group_id &&
            event.queryStringParameters.patient_id
        ) {
            const patientId = event.queryStringParameters.patient_id;
            const studentEmail = event.queryStringParameters.email;
            const simulationGroupId = event.queryStringParameters.simulation_group_id;
    
            try {
                // Step 1: Get the user ID using the student_email
                const userResult = await sqlConnection`
                    SELECT user_id
                    FROM "users"
                    WHERE user_email = ${studentEmail}
                    LIMIT 1;
                `;
    
                if (userResult.length === 0) {
                    response.statusCode = 404;
                    response.body = JSON.stringify({
                        error: "Student not found.",
                    });
                    break;
                }
    
                const userId = userResult[0].user_id;
    
                // Step 2: Get the student_interaction_id for the specific student and patient
                const studentPatientData = await sqlConnection`
                    SELECT student_interaction_id
                    FROM "student_interactions"
                    WHERE patient_id = ${patientId}
                    AND enrolment_id = (
                        SELECT enrolment_id
                        FROM "enrolments"
                        WHERE user_id = ${userId} AND simulation_group_id = ${simulationGroupId}
                    )
                `;
    
                const studentPatientId = studentPatientData[0]?.student_interaction_id;
    
                if (!studentPatientId) {
                    response.statusCode = 404;
                    response.body = JSON.stringify({
                        error: "Student patient not found",
                    });
                    break;
                }
    
                // Step 3: Update the last accessed timestamp for the student_interactions entry
                await sqlConnection`
                    UPDATE "student_interactions"
                    SET last_accessed = CURRENT_TIMESTAMP
                    WHERE student_interaction_id = ${studentPatientId};
                `;
    
                // Step 4: Retrieve session data specific to the student's patient
                const data = await sqlConnection`
                    SELECT "sessions".*
                    FROM "sessions"
                    WHERE student_interaction_id = ${studentPatientId}
                    ORDER BY "sessions".last_accessed, "sessions".session_id;
                `;
    
                // Step 5: Get enrolment ID for the log entry
                const enrolmentData = await sqlConnection`
                    SELECT enrolment_id
                    FROM "enrolments"
                    WHERE user_id = ${userId} AND simulation_group_id = ${simulationGroupId};
                `;
    
                const enrolmentId = enrolmentData[0]?.enrolment_id;
    
                // Step 6: Insert into User_Engagement_Log using user_id
                await sqlConnection`
                    INSERT INTO "user_engagement_log" (
                        log_id, user_id, simulation_group_id, patient_id, enrolment_id, timestamp, engagement_type
                    )
                    VALUES (
                        uuid_generate_v4(),
                        ${userId},
                        ${simulationGroupId},
                        ${patientId},
                        ${enrolmentId},
                        CURRENT_TIMESTAMP,
                        'patient access'
                    );
                `;
    
                response.body = JSON.stringify(data);
            } catch (err) {
                console.error(err);
                response.statusCode = 500;
                response.body = JSON.stringify({ error: "Internal server error" });
            }
        } else {
            response.statusCode = 400;
            response.body = JSON.stringify({ error: "Invalid value" });
        }
        break;
      case "POST /student/create_session":
        if (
            event.queryStringParameters != null &&
            event.queryStringParameters.patient_id &&
            event.queryStringParameters.email &&
            event.queryStringParameters.simulation_group_id &&
            event.queryStringParameters.session_name
        ) {
            const patientId = event.queryStringParameters.patient_id;
            const studentEmail = event.queryStringParameters.email;
            const simulationGroupId = event.queryStringParameters.simulation_group_id;
            const sessionName = event.queryStringParameters.session_name;
    
            try {
                // Step 1: Get the user ID using the student_email
                const userResult = await sqlConnection`
                    SELECT user_id
                    FROM "users"
                    WHERE user_email = ${studentEmail}
                    LIMIT 1;
                `;
    
                if (userResult.length === 0) {
                    response.statusCode = 404;
                    response.body = JSON.stringify({ error: "Student not found." });
                    break;
                }
    
                const userId = userResult[0].user_id;
    
                // Step 2: Get the student_interaction_id for the specific student and patient
                const studentPatientData = await sqlConnection`
                    SELECT student_interaction_id
                    FROM "student_interactions"
                    WHERE patient_id = ${patientId}
                      AND enrolment_id = (
                        SELECT enrolment_id
                        FROM "enrolments"
                        WHERE user_id = ${userId} AND simulation_group_id = ${simulationGroupId}
                    );
                `;
    
                const studentPatientId = studentPatientData[0]?.student_interaction_id;
    
                if (!studentPatientId) {
                    response.statusCode = 404;
                    response.body = JSON.stringify({ error: "Student patient not found." });
                    break;
                }
    
                // Step 3: Update the last_accessed timestamp for the student_interaction entry
                await sqlConnection`
                    UPDATE "student_interactions"
                    SET last_accessed = CURRENT_TIMESTAMP
                    WHERE student_interaction_id = ${studentPatientId};
                `;
    
                // Step 4: Insert a new session with the session_name
                const sessionData = await sqlConnection`
                    INSERT INTO "sessions" (session_id, student_interaction_id, session_name, session_context_embeddings, last_accessed, notes)
                    VALUES (
                        uuid_generate_v4(),
                        ${studentPatientId},
                        ${sessionName},
                        ARRAY[]::float[],
                        CURRENT_TIMESTAMP,
                        NULL
                    )
                    RETURNING *;
                `;
    
                // Step 5: Log the session creation in the User Engagement Log
                const enrolmentData = await sqlConnection`
                    SELECT enrolment_id
                    FROM "enrolments"
                    WHERE user_id = ${userId} AND simulation_group_id = ${simulationGroupId};
                `;
    
                const enrolmentId = enrolmentData[0]?.enrolment_id;
    
                if (enrolmentId) {
                    await sqlConnection`
                        INSERT INTO "user_engagement_log" (
                            log_id, user_id, simulation_group_id, patient_id, enrolment_id, timestamp, engagement_type
                        ) VALUES (
                            uuid_generate_v4(),
                            ${userId},
                            ${simulationGroupId},
                            ${patientId},
                            ${enrolmentId},
                            CURRENT_TIMESTAMP,
                            'session creation'
                        );
                    `;
                }
    
                response.body = JSON.stringify(sessionData);
            } catch (err) {
                response.statusCode = 500;
                console.error(err);
                response.body = JSON.stringify({ error: "Internal server error" });
            }
        } else {
            response.statusCode = 400;
            response.body = JSON.stringify({ error: "Invalid value" });
        }
        break;
      case "DELETE /student/delete_session":
        if (
            event.queryStringParameters != null &&
            event.queryStringParameters.session_id &&
            event.queryStringParameters.email &&
            event.queryStringParameters.simulation_group_id &&
            event.queryStringParameters.patient_id
        ) {
            const sessionId = event.queryStringParameters.session_id;
            const studentEmail = event.queryStringParameters.email;
            const simulationGroupId = event.queryStringParameters.simulation_group_id;
            const patientId = event.queryStringParameters.patient_id;
    
            try {
                // Step 1: Get the user ID using the student_email
                const userResult = await sqlConnection`
                    SELECT user_id
                    FROM "users"
                    WHERE user_email = ${studentEmail}
                    LIMIT 1;
                `;
    
                if (userResult.length === 0) {
                    response.statusCode = 404;
                    response.body = JSON.stringify({ error: "Student not found." });
                    break;
                }
    
                const userId = userResult[0].user_id;
    
                // Step 2: Update last_accessed for the corresponding student_interaction entry
                await sqlConnection`
                    UPDATE "student_interactions"
                    SET last_accessed = CURRENT_TIMESTAMP
                    WHERE student_interaction_id = (
                        SELECT student_interaction_id
                        FROM "sessions"
                        WHERE session_id = ${sessionId}
                    );
                `;
    
                // Step 3: Delete the session and get the result
                const deleteResult = await sqlConnection`
                    DELETE FROM "sessions"
                    WHERE session_id = ${sessionId}
                    RETURNING *;
                `;
    
                if (!deleteResult.length) {
                    response.statusCode = 404;
                    response.body = JSON.stringify({ error: "Session not found." });
                    break;
                }
    
                // Step 4: Get the enrolment ID using user_id and simulation_group_id
                const enrolmentData = await sqlConnection`
                    SELECT enrolment_id
                    FROM "enrolments"
                    WHERE user_id = ${userId} AND simulation_group_id = ${simulationGroupId};
                `;
    
                if (!enrolmentData.length) {
                    response.statusCode = 404;
                    response.body = JSON.stringify({ error: "Enrolment not found." });
                    break;
                }
    
                const enrolmentId = enrolmentData[0].enrolment_id;
    
                // Step 5: Insert an entry into the User_Engagement_Log
                await sqlConnection`
                    INSERT INTO "user_engagement_log" (
                        log_id, user_id, simulation_group_id, patient_id, enrolment_id, timestamp, engagement_type
                    ) VALUES (
                        uuid_generate_v4(),
                        ${userId},
                        ${simulationGroupId},
                        ${patientId},
                        ${enrolmentId},
                        CURRENT_TIMESTAMP,
                        'session deletion'
                    );
                `;
    
                response.body = JSON.stringify({ success: "Session deleted" });
            } catch (err) {
                response.statusCode = 500;
                console.error(err);
                response.body = JSON.stringify({ error: "Internal server error" });
            }
        } else {
            response.statusCode = 400;
            response.body = JSON.stringify({
                error: "session_id, email, simulation_group_id, and patient_id are required",
            });
        }
        break;
      case "GET /student/get_messages":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.session_id
        ) {
          try {
            const sessionId = event.queryStringParameters.session_id;

            // Query to get all messages in the given session, sorted by time_sent in ascending order (oldest to newest)
            const data = await sqlConnection`
                      SELECT *
                      FROM "messages"
                      WHERE session_id = ${sessionId}
                      ORDER BY time_sent ASC;
                  `;

            if (data.length > 0) {
              response.body = JSON.stringify(data);
              response.statusCode = 200;
            } else {
              response.body = JSON.stringify({
                message: "No messages found for this session.",
              });
              response.statusCode = 404;
            }
          } catch (err) {
            response.statusCode = 500;
            console.log(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({ error: "session_id is required" });
        }
        break;
        case "POST /student/create_message":
          if (
              event.queryStringParameters != null &&
              event.queryStringParameters.session_id &&
              event.queryStringParameters.email &&
              event.queryStringParameters.simulation_group_id &&
              event.queryStringParameters.patient_id &&
              event.body
          ) {
              const sessionId = event.queryStringParameters.session_id;
              const { message_content } = JSON.parse(event.body);
              const studentEmail = event.queryStringParameters.email;
              const simulationGroupId = event.queryStringParameters.simulation_group_id;
              const patientId = event.queryStringParameters.patient_id;
      
              try {
                  // Insert the new message into the Messages table with a generated UUID for message_id
                  const messageData = await sqlConnection`
                      INSERT INTO "messages" (message_id, session_id, student_sent, message_content, time_sent)
                      VALUES (uuid_generate_v4(), ${sessionId}, true, ${message_content}, CURRENT_TIMESTAMP)
                      RETURNING *;
                  `;
      
                  // Update the last_accessed field in the Sessions table
                  await sqlConnection`
                      UPDATE "sessions"
                      SET last_accessed = CURRENT_TIMESTAMP
                      WHERE session_id = ${sessionId};
                  `;
      
                  // Retrieve user_id based on studentEmail
                  const userData = await sqlConnection`
                      SELECT user_id
                      FROM "users"
                      WHERE user_email = ${studentEmail};
                  `;
      
                  const userId = userData[0]?.user_id;
      
                  if (userId) {
                      // Retrieve the enrolment ID using user_id
                      const enrolmentData = await sqlConnection`
                          SELECT enrolment_id
                          FROM "enrolments"
                          WHERE user_id = ${userId} AND simulation_group_id = ${simulationGroupId};
                      `;
      
                      const enrolmentId = enrolmentData[0]?.enrolment_id;
      
                      if (enrolmentId) {
                          await sqlConnection`
                              INSERT INTO "user_engagement_log" (
                                  log_id, user_id, simulation_group_id, patient_id, enrolment_id, timestamp, engagement_type
                              )
                              VALUES (
                                  uuid_generate_v4(), 
                                  ${userId}, 
                                  ${simulationGroupId}, 
                                  ${patientId}, 
                                  ${enrolmentId}, 
                                  CURRENT_TIMESTAMP, 
                                  'message creation'
                              );
                          `;
                      }
                  }
      
                  response.body = JSON.stringify(messageData);
              } catch (err) {
                  response.statusCode = 500;
                  console.error(err);
                  response.body = JSON.stringify({ error: "Internal server error" });
              }
          } else {
              response.statusCode = 400;
              response.body = JSON.stringify({
                  error: "session_id and message_content are required",
              });
          }
          break;
        case "POST /student/create_ai_message":
          if (
              event.queryStringParameters != null &&
              event.queryStringParameters.session_id &&
              event.queryStringParameters.email &&
              event.queryStringParameters.simulation_group_id &&
              event.queryStringParameters.patient_id &&
              event.body
          ) {
              const sessionId = event.queryStringParameters.session_id;
              const { message_content } = JSON.parse(event.body);
              const studentEmail = event.queryStringParameters.email;
              const simulationGroupId = event.queryStringParameters.simulation_group_id;
              const patientId = event.queryStringParameters.patient_id;
      
              try {
                  // Insert the new AI message into the Messages table with a generated UUID for message_id
                  const messageData = await sqlConnection`
                      INSERT INTO "messages" (message_id, session_id, student_sent, message_content, time_sent)
                      VALUES (uuid_generate_v4(), ${sessionId}, false, ${message_content}, CURRENT_TIMESTAMP)
                      RETURNING *;
                  `;
      
                  // Update the last_accessed field in the Sessions table
                  await sqlConnection`
                      UPDATE "sessions"
                      SET last_accessed = CURRENT_TIMESTAMP
                      WHERE session_id = ${sessionId};
                  `;
      
                  // Retrieve user_id based on studentEmail
                  const userData = await sqlConnection`
                      SELECT user_id
                      FROM "users"
                      WHERE user_email = ${studentEmail};
                  `;
      
                  const userId = userData[0]?.user_id;
      
                  if (userId) {
                      // Retrieve the enrolment ID using user_id
                      const enrolmentData = await sqlConnection`
                          SELECT enrolment_id
                          FROM "enrolments"
                          WHERE user_id = ${userId} AND simulation_group_id = ${simulationGroupId};
                      `;
      
                      const enrolmentId = enrolmentData[0]?.enrolment_id;
      
                      if (enrolmentId) {
                          await sqlConnection`
                              INSERT INTO "user_engagement_log" (
                                  log_id, user_id, simulation_group_id, patient_id, enrolment_id, timestamp, engagement_type
                              )
                              VALUES (
                                  uuid_generate_v4(), 
                                  ${userId}, 
                                  ${simulationGroupId}, 
                                  ${patientId}, 
                                  ${enrolmentId}, 
                                  CURRENT_TIMESTAMP, 
                                  'AI message creation'
                              );
                          `;
                      }
                  }
      
                  response.body = JSON.stringify(messageData);
              } catch (err) {
                  response.statusCode = 500;
                  console.error(err);
                  response.body = JSON.stringify({ error: "Internal server error" });
              }
          } else {
              response.statusCode = 400;
              response.body = JSON.stringify({
                  error: "session_id and message_content are required",
              });
          }
          break;
      case "POST /student/enroll_student":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.student_email &&
          event.queryStringParameters.group_access_code
        ) {
          const { student_email, group_access_code } =
            event.queryStringParameters;
    
          try {
            // Step 1: Retrieve the user ID using the student_email
            const userResult = await sqlConnection`
                  SELECT user_id
                  FROM "users"
                  WHERE user_email = ${student_email}
                  LIMIT 1;
              `;
    
            if (userResult.length === 0) {
              response.statusCode = 404;
              response.body = JSON.stringify({
                error: "Student not found.",
              });
              break;
            }
    
            const user_id = userResult[0].user_id;
    
            // Step 2: Retrieve the simulation_group_id using the access code
            const groupResult = await sqlConnection`
                  SELECT simulation_group_id
                  FROM "simulation_groups"
                  WHERE group_access_code = ${group_access_code}
                  AND group_student_access = TRUE
                  LIMIT 1;
              `;
    
            if (groupResult.length === 0) {
              response.statusCode = 404;
              response.body = JSON.stringify({
                error: "Invalid group access code or group not available.",
              });
              break;
            }
    
            const simulation_group_id = groupResult[0].simulation_group_id;
    
            // Step 3: Insert enrollment into enrolments table
            const enrollmentResult = await sqlConnection`
                  INSERT INTO "enrolments" (enrolment_id, user_id, simulation_group_id, enrolment_type, time_enroled)
                  VALUES (uuid_generate_v4(), ${user_id}, ${simulation_group_id}, 'student', CURRENT_TIMESTAMP)
                  ON CONFLICT (simulation_group_id, user_id) DO NOTHING
                  RETURNING enrolment_id;
              `;
    
            const enrolment_id = enrollmentResult[0]?.enrolment_id;
    
            if (enrolment_id) {
              // Step 4: Retrieve all patient IDs for the simulation group
              const patientsResult = await sqlConnection`
                    SELECT patient_id
                    FROM "patients"
                    WHERE simulation_group_id = ${simulation_group_id};
                `;
    
              // Step 5: Insert a record into student_interactions for each patient
              const studentPatientInsertions = patientsResult.map((patient) => {
                return sqlConnection`
                      INSERT INTO "student_interactions" (student_interaction_id, patient_id, enrolment_id, patient_score, last_accessed, patient_context_embedding, is_completed)
                      VALUES (uuid_generate_v4(), ${patient.patient_id}, ${enrolment_id}, 0, CURRENT_TIMESTAMP, NULL, FALSE);
                  `;
              });
    
              // Execute all insertions
              await Promise.all(studentPatientInsertions);
            }
    
            response.statusCode = 201; // Set status to 201 on successful enrollment
            response.body = JSON.stringify({
              message: "Student enrolled and patient records created successfully.",
            });
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error:
              "student_email and group_access_code query parameters are required",
          });
        }
        break;
      case "GET /session/messages":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.session_id
        ) {
          try {
            const sessionId = event.queryStringParameters.session_id;

            // Fetch all messages in the specified session
            const messages = await sqlConnection`
                      SELECT *
                      FROM "Messages"
                      WHERE "session_id" = ${sessionId}
                      ORDER BY "time_sent" ASC;
                  `;

            response.body = JSON.stringify(messages);
          } catch (err) {
            console.log(err);
            response.statusCode = 500;
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error: "session_id query parameter is required",
          });
        }
        break;
      case "PUT /student/update_session_name":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.session_id &&
          event.body
        ) {
          try {
            const { session_id } = event.queryStringParameters;
            const { session_name } = JSON.parse(event.body);

            // Update the session name
            const updateResult = await sqlConnection`
                UPDATE "sessions"
                SET session_name = ${session_name}
                WHERE session_id = ${session_id}
                RETURNING *;
              `;

            if (updateResult.length === 0) {
              response.statusCode = 404;
              response.body = JSON.stringify({ error: "Session not found" });
              break;
            }

            response.statusCode = 200;
            response.body = JSON.stringify(updateResult[0]);
          } catch (err) {
            console.error(err);
            response.statusCode = 500;
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({ error: "Invalid value" });
        }
        break;
      case "POST /student/update_patient_score":
        if (
            event.queryStringParameters != null &&
            event.queryStringParameters.patient_id &&
            event.queryStringParameters.student_email &&
            event.queryStringParameters.simulation_group_id &&
            event.queryStringParameters.llm_verdict
        ) {
            try {
                const patientId = event.queryStringParameters.patient_id;
                const studentEmail = event.queryStringParameters.student_email;
                const simulationGroupId = event.queryStringParameters.simulation_group_id;
                const llmVerdict =
                    event.queryStringParameters.llm_verdict === "true"; // Convert to boolean
    
                // Retrieve user_id from the Users table
                const userData = await sqlConnection`
                    SELECT user_id
                    FROM "users"
                    WHERE user_email = ${studentEmail};
                `;
    
                const userId = userData[0]?.user_id;
    
                if (!userId) {
                    response.statusCode = 404;
                    response.body = JSON.stringify({
                        error: "User not found",
                    });
                    break;
                }
    
                // Get the student_interaction_id and current score for the student and patient
                const studentPatientData = await sqlConnection`
                    SELECT student_interaction_id, patient_score
                    FROM "student_interactions"
                    WHERE patient_id = ${patientId}
                      AND enrolment_id = (
                        SELECT enrolment_id
                        FROM "enrolments"
                        WHERE user_id = ${userId} AND simulation_group_id = ${simulationGroupId}
                    );
                `;
    
                const studentPatientId = studentPatientData[0]?.student_interaction_id;
                const currentScore = studentPatientData[0]?.patient_score;
    
                if (!studentPatientId) {
                    response.statusCode = 404;
                    response.body = JSON.stringify({
                        error: "Student patient entry not found.",
                    });
                    break;
                }
    
                // If llm_verdict is false and the current score is 100, no update is needed
                if (!llmVerdict && currentScore === 100) {
                    response.statusCode = 200;
                    response.body = JSON.stringify({
                        message: "No changes made. Patient score is already 100.",
                    });
                    break;
                }
    
                // Determine the new score based on llm_verdict
                const newScore = llmVerdict ? 100 : 0;
    
                // Update the patient score for the student
                await sqlConnection`
                    UPDATE "student_interactions"
                    SET patient_score = ${newScore}
                    WHERE student_interaction_id = ${studentPatientId};
                `;
    
                response.statusCode = 200;
                response.body = JSON.stringify({
                    message: "Patient score updated successfully.",
                });
            } catch (err) {
                console.error(err);
                response.statusCode = 500;
                response.body = JSON.stringify({ error: "Internal server error" });
            }
        } else {
            response.statusCode = 400;
            response.body = JSON.stringify({
                error: "Invalid query parameters.",
            });
        }
        break;
      case "GET /student/get_notes":
        if (
            event.queryStringParameters &&
            event.queryStringParameters.session_id
        ) {
            const sessionId = event.queryStringParameters.session_id;
    
            try {
                // Query to get the notes for the session
                const notesData = await sqlConnection`
                    SELECT notes 
                    FROM "sessions" 
                    WHERE session_id = ${sessionId};
                `;
    
                if (notesData.length > 0) {
                    response.statusCode = 200;
                    response.body = JSON.stringify({ notes: notesData[0].notes });
                } else {
                    response.statusCode = 404;
                    response.body = JSON.stringify({ error: "Notes not found." });
                }
            } catch (err) {
                response.statusCode = 500;
                console.error(err);
                response.body = JSON.stringify({ error: "Internal server error" });
            }
        } else {
            response.statusCode = 400;
            response.body = JSON.stringify({ error: "session_id is required." });
        }
        break;
      case "PUT /student/update_notes":
        if (
            event.queryStringParameters &&
            event.queryStringParameters.session_id &&
            event.body
        ) {
            const sessionId = event.queryStringParameters.session_id;
            const { notes } = JSON.parse(event.body);
    
            try {
                // Update the notes for the session
                const updateResult = await sqlConnection`
                    UPDATE "sessions" 
                    SET notes = ${notes}, last_accessed = CURRENT_TIMESTAMP 
                    WHERE session_id = ${sessionId}
                    RETURNING *;
                `;
    
                if (updateResult.length > 0) {
                    response.statusCode = 200;
                    response.body = JSON.stringify({
                        message: "Notes updated successfully.",
                        session: updateResult[0],
                    });
                } else {
                    response.statusCode = 404;
                    response.body = JSON.stringify({ error: "Session not found." });
                }
            } catch (err) {
                response.statusCode = 500;
                console.error(err);
                response.body = JSON.stringify({ error: "Internal server error" });
            }
        } else {
            response.statusCode = 400;
            response.body = JSON.stringify({ error: "Invalid input." });
        }
        break;
      case "GET /student/get_completion_status":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.student_email &&
          event.queryStringParameters.simulation_group_id
        ) {
          const { student_email, simulation_group_id } = event.queryStringParameters;
      
          try {
            // Step 1: Get the user_id from the student's email
            const userResult = await sqlConnection`
              SELECT user_id FROM "users" WHERE user_email = ${student_email} LIMIT 1;
            `;
      
            const userId = userResult[0]?.user_id;
      
            if (!userId) {
              response.statusCode = 404;
              response.body = JSON.stringify({ error: "Student not found" });
              break;
            }
      
            // Step 2: Fetch all interactions with completion status for the specified simulation group
            const completionStatus = await sqlConnection`
              SELECT si.student_interaction_id, si.is_completed, p.patient_name
              FROM "student_interactions" si
              JOIN "patients" p ON si.patient_id = p.patient_id
              JOIN "enrolments" e ON si.enrolment_id = e.enrolment_id
              WHERE e.user_id = ${userId} AND e.simulation_group_id = ${simulation_group_id}
              ORDER BY p.patient_name;
            `;
      
            response.statusCode = 200;
            response.body = JSON.stringify(completionStatus);
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({ error: "student_email and simulation_group_id are required" });
        }
        break;
      case "GET /student/empathy_summary":
        // Import the studentEmpathySummary handler
        const studentEmpathySummary = require('./studentEmpathySummary');
        // Call the handler and return its response
        const empathySummaryResponse = await studentEmpathySummary(event, sqlConnection);
        response.statusCode = empathySummaryResponse.statusCode;
        response.body = empathySummaryResponse.body;
        break;
      default:
        throw new Error(`Unsupported route: "${pathData}"`);
    }
  } catch (error) {
    response.statusCode = 400;
    console.log(error);
    response.body = JSON.stringify(error.message);
  }
  console.log(response);

  return response;
};
