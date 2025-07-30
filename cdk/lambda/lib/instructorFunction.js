const { initializeConnection } = require("./lib.js");
let { SM_DB_CREDENTIALS, RDS_PROXY_ENDPOINT, USER_POOL } = process.env;
const {
  CognitoIdentityProviderClient,
  AdminGetUserCommand,
} = require("@aws-sdk/client-cognito-identity-provider");

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
  const instructorEmail = queryStringParams.instructor_email;

  const isUnauthorized =
    (queryEmail && queryEmail !== userEmailAttribute) ||
    (instructorEmail && instructorEmail !== userEmailAttribute);

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

  function generateAccessCode() {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let code = "";
    for (let i = 0; i < 16; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code.match(/.{1,4}/g).join("-");
  }

  let data;
  try {
    const pathData = event.httpMethod + " " + event.resource;
    switch (pathData) {
      case "GET /instructor/student_group":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.email
        ) {
          const email = event.queryStringParameters.email;

          try {
            // First, get the user_id for the given email
            const userResult = await sqlConnection`
              SELECT user_id FROM "users" WHERE user_email = ${email};
            `;

            if (userResult.length === 0) {
              response.statusCode = 404;
              response.body = JSON.stringify({ error: "User not found" });
              break;
            }

            const userId = userResult[0].user_id;

            // Now, fetch the simulation groups for that user_id
            const data = await sqlConnection`
              SELECT sg.*
              FROM "enrolments" e
              JOIN "simulation_groups" sg 
              ON e.simulation_group_id = sg.simulation_group_id
              WHERE e.user_id = ${userId}
              ORDER BY sg.group_name, sg.simulation_group_id;
            `;

            response.statusCode = 200;
            response.body = JSON.stringify(data);
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
      case "GET /instructor/groups":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.email
        ) {
          const instructorEmail = event.queryStringParameters.email;

          try {
            // First, get the user ID using the email
            const userIdResult = await sqlConnection`
                SELECT user_id
                FROM "users"
                WHERE user_email = ${instructorEmail}
                LIMIT 1;
              `;

            const userId = userIdResult[0]?.user_id;

            if (!userId) {
              response.statusCode = 404;
              response.body = JSON.stringify({ error: "Instructor not found" });
              break;
            }

            // Query to get all simulation groups where the instructor is enrolled
            const data = await sqlConnection`
                SELECT g.*
                FROM "enrolments" e
                JOIN "simulation_groups" g ON e.simulation_group_id = g.simulation_group_id
                WHERE e.user_id = ${userId}
                AND e.enrolment_type = 'instructor'
                ORDER BY g.group_name, g.simulation_group_id;
              `;

            response.statusCode = 200;
            response.body = JSON.stringify(data);
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({ error: "email is required" });
        }
        break;
      case "GET /instructor/analytics":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.simulation_group_id
        ) {
          const simulationGroupId =
            event.queryStringParameters.simulation_group_id;

          try {
            // Query to get all patients and their message counts, separated by student and AI messages
            const messageCreations = await sqlConnection`
                    SELECT p.patient_id, p.patient_name, p.patient_number, 
                        COUNT(CASE WHEN m.student_sent THEN 1 ELSE NULL END) AS student_message_count,
                        COUNT(CASE WHEN NOT m.student_sent THEN 1 ELSE NULL END) AS ai_message_count
                    FROM "patients" p
                    LEFT JOIN "student_interactions" sp ON p.patient_id = sp.patient_id
                    LEFT JOIN "sessions" s ON sp.student_interaction_id = s.student_interaction_id
                    LEFT JOIN "messages" m ON s.session_id = m.session_id
                    LEFT JOIN "enrolments" e ON sp.enrolment_id = e.enrolment_id
                    LEFT JOIN "users" u ON e.user_id = u.user_id
                    WHERE p.simulation_group_id = ${simulationGroupId}
                    AND 'student' = ANY(u.roles)
                    GROUP BY p.patient_id, p.patient_name, p.patient_number
                    ORDER BY p.patient_number ASC, p.patient_name ASC;
                `;

            // Query to get the number of patient accesses using User_Engagement_Log, filtering by student role
            const patientAccesses = await sqlConnection`
                    SELECT p.patient_id, COUNT(uel.log_id) AS access_count
                    FROM "patients" p
                    LEFT JOIN "user_engagement_log" uel ON p.patient_id = uel.patient_id
                    LEFT JOIN "enrolments" e ON uel.enrolment_id = e.enrolment_id
                    LEFT JOIN "users" u ON e.user_id = u.user_id
                    WHERE p.simulation_group_id = ${simulationGroupId}
                    AND uel.engagement_type = 'patient access'
                    AND 'student' = ANY(u.roles)
                    GROUP BY p.patient_id;
                `;

            // Query to get the percentage of scores evaluated by the LLM for each patient, filtering by student role
            const aiScores = await sqlConnection`
                    SELECT p.patient_id, p.llm_completion,
                        CASE 
                            WHEN COUNT(sp.student_interaction_id) = 0 THEN 0 
                            ELSE COUNT(CASE WHEN sp.patient_score = 100 THEN 1 END) * 100.0 / COUNT(sp.student_interaction_id)
                        END AS ai_score_percentage
                    FROM "patients" p
                    LEFT JOIN "student_interactions" sp ON p.patient_id = sp.patient_id
                    LEFT JOIN "enrolments" e ON sp.enrolment_id = e.enrolment_id
                    LEFT JOIN "users" u ON e.user_id = u.user_id
                    WHERE p.simulation_group_id = ${simulationGroupId}
                    AND 'student' = ANY(u.roles)
                    GROUP BY p.patient_id;
                `;

            // Query to calculate the percentage of completed interactions for each patient, filtering by student role
            const instructorCompletionPercentages = await sqlConnection`
                    SELECT 
                        p.patient_id, 
                        CASE 
                            WHEN COUNT(sp.student_interaction_id) = 0 THEN 0 
                            ELSE COUNT(CASE WHEN sp.is_completed THEN 1 END) * 100.0 / COUNT(sp.student_interaction_id)
                        END AS instructor_completion_percentage
                    FROM "patients" p
                    LEFT JOIN "student_interactions" sp ON p.patient_id = sp.patient_id
                    LEFT JOIN "enrolments" e ON sp.enrolment_id = e.enrolment_id
                    LEFT JOIN "users" u ON e.user_id = u.user_id
                    WHERE p.simulation_group_id = ${simulationGroupId}
                    AND 'student' = ANY(u.roles)
                    GROUP BY p.patient_id;
                `;

            // Combine all data into a single response, ensuring all patients are included
            const analyticsData = messageCreations.map((patient) => {
              const accesses =
                patientAccesses.find(
                  (pa) => pa.patient_id === patient.patient_id
                ) || {};
              const aiScore =
                aiScores.find((ps) => ps.patient_id === patient.patient_id) ||
                {};
              const instructorCompletionData =
                instructorCompletionPercentages.find(
                  (cp) => cp.patient_id === patient.patient_id
                ) || {};

              return {
                patient_id: patient.patient_id,
                patient_name: patient.patient_name,
                patient_number: patient.patient_number,
                student_message_count: patient.student_message_count || 0,
                ai_message_count: patient.ai_message_count || 0,
                access_count: accesses.access_count || 0,
                ai_score_percentage:
                  parseFloat(aiScore.ai_score_percentage) || 0,
                llm_completion: aiScore.llm_completion || false,
                instructor_completion_percentage:
                  parseFloat(
                    instructorCompletionData.instructor_completion_percentage
                  ) || 0,
              };
            });

            response.statusCode = 200;
            response.body = JSON.stringify(analyticsData);
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error: "simulation_group_id is required",
          });
        }
        break;
      case "PUT /instructor/update_metadata":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.patient_id &&
          event.queryStringParameters.filename &&
          event.queryStringParameters.filetype
        ) {
          const patient_id = event.queryStringParameters.patient_id;
          const filename = event.queryStringParameters.filename;
          const filetype = event.queryStringParameters.filetype;
          const { metadata } = JSON.parse(event.body);

          try {
            // Query to find the file with the given patient_id and filename
            const existingFile = await sqlConnection`
                      SELECT * FROM "patient_data"
                      WHERE patient_id = ${patient_id}
                      AND filename = ${filename}
                      AND filetype = ${filetype};
                  `;

            if (existingFile.length === 0) {
              const result = await sqlConnection`
                INSERT INTO "patient_data" (patient_id, filename, filetype, metadata)
                VALUES (${patient_id}, ${filename}, ${filetype}, ${metadata})
                RETURNING *;
              `;
              response.body = JSON.stringify({
                message: "File metadata added successfully",
              });
            }

            // Update the metadata field
            const result = await sqlConnection`
                      UPDATE "patient_data"
                      SET metadata = ${metadata}
                      WHERE patient_id = ${patient_id}
                      AND filename = ${filename}
                      AND filetype = ${filetype}
                      RETURNING *;
                  `;

            if (result.length > 0) {
              response.statusCode = 200;
              response.body = JSON.stringify(result[0]);
            } else {
              response.statusCode = 500;
              response.body = JSON.stringify({
                error: "Failed to update metadata.",
              });
            }
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error: "patient_id and filename are required",
          });
        }
        break;
      case "POST /instructor/create_patient":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.simulation_group_id &&
          event.queryStringParameters.patient_name &&
          event.queryStringParameters.patient_number &&
          event.queryStringParameters.patient_age &&
          event.queryStringParameters.patient_gender &&
          event.queryStringParameters.instructor_email &&
          event.body
        ) {
          const {
            simulation_group_id,
            patient_name,
            patient_number,
            patient_age,
            patient_gender,
            instructor_email,
          } = event.queryStringParameters;

          const { patient_prompt } = JSON.parse(event.body);

          try {
            // Check if a patient with the same name already exists in the simulation group
            const existingPatient = await sqlConnection`
                    SELECT * FROM "patients"
                    WHERE simulation_group_id = ${simulation_group_id}
                    AND patient_name = ${patient_name};
                `;

            if (existingPatient.length > 0) {
              response.statusCode = 400;
              response.body = JSON.stringify({
                error:
                  "A patient with this name already exists in the given simulation group.",
              });
              break;
            }

            feminine_voices = [
              "tiffany",
              "amy",
              "ambre",
              "beatrice",
              "greta",
              "lupe",
            ];
            masculine_voices = [
              "matthew",
              "florian",
              "lorenzo",
              "lennart",
              "carlos",
            ];

            voice_id =
              patient_gender.toLowerCase() === "female"
                ? randomChoice(feminine_voices)
                : randomChoice(masculine_voices);

            // Insert new patient into the "patients" table with age and gender
            const newPatient = await sqlConnection`
                    INSERT INTO "patients" (
                        patient_id, 
                        simulation_group_id, 
                        patient_name, 
                        patient_number, 
                        patient_age, 
                        patient_gender,
                        patient_prompt,
                        voice_id
                    )
                    VALUES (
                        uuid_generate_v4(), 
                        ${simulation_group_id}, 
                        ${patient_name}, 
                        ${patient_number}, 
                        ${patient_age}, 
                        ${patient_gender}, 
                        ${patient_prompt},
                        ${voice_id}
                    )
                    RETURNING *;
                `;

            // Log the patient creation in the User Engagement Log
            await sqlConnection`
                    INSERT INTO "user_engagement_log" (
                        log_id, 
                        user_id, 
                        simulation_group_id, 
                        patient_id, 
                        enrolment_id, 
                        timestamp, 
                        engagement_type
                    )
                    VALUES (
                        uuid_generate_v4(),
                        (SELECT user_id FROM "users" WHERE user_email = ${instructor_email}),
                        ${simulation_group_id},
                        ${newPatient[0].patient_id},
                        null,
                        CURRENT_TIMESTAMP,
                        'instructor_created_patient'
                    );
                `;

            // Find all student enrolments for the given simulation group
            const enrolments = await sqlConnection`
                    SELECT enrolment_id FROM "enrolments"
                    WHERE simulation_group_id = ${simulation_group_id};
                `;

            // Create entries for each enrolment in the "student_interactions" table
            await Promise.all(
              enrolments.map(async (enrolment) => {
                await sqlConnection`
                            INSERT INTO "student_interactions" (
                                student_interaction_id, 
                                patient_id, 
                                enrolment_id, 
                                patient_score
                            )
                            VALUES (
                                uuid_generate_v4(), 
                                ${newPatient[0].patient_id}, 
                                ${enrolment.enrolment_id}, 
                                0
                            );
                        `;
              })
            );

            response.statusCode = 201;
            response.body = JSON.stringify(newPatient[0]);
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error:
              "simulation_group_id, patient_name, patient_number, patient_age, patient_gender, or instructor_email is missing",
          });
        }
        break;
      case "PUT /instructor/reorder_patient":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.patient_id &&
          event.queryStringParameters.patient_number &&
          event.queryStringParameters.instructor_email
        ) {
          const { patient_id, patient_number, instructor_email } =
            event.queryStringParameters;
          const { patient_name } = JSON.parse(event.body || "{}");

          if (patient_name) {
            try {
              // Update the patient in the patients table
              await sqlConnection`
                    UPDATE "patients"
                    SET patient_name = ${patient_name}, patient_number = ${patient_number}
                    WHERE patient_id = ${patient_id};
                  `;

              // Insert into User Engagement Log
              await sqlConnection`
                    INSERT INTO "user_engagement_log" (log_id, user_id, simulation_group_id, patient_id, enrolment_id, timestamp, engagement_type)
                    VALUES (uuid_generate_v4(), (SELECT user_id FROM "users" WHERE user_email = ${instructor_email}), NULL, ${patient_id}, NULL, CURRENT_TIMESTAMP, 'instructor_edited_patient');
                  `;

              response.statusCode = 200;
              response.body = JSON.stringify({
                message: "Patient updated successfully",
              });
            } catch (err) {
              response.statusCode = 500;
              console.error(err);
              response.body = JSON.stringify({
                error: "Internal server error",
              });
            }
          } else {
            response.statusCode = 400;
            response.body = JSON.stringify({
              error: "patient_name is required in the body",
            });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error:
              "patient_id, patient_number, or instructor_email is missing in query string parameters",
          });
        }
        break;
      case "PUT /instructor/edit_patient":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.patient_id &&
          event.queryStringParameters.instructor_email &&
          event.queryStringParameters.simulation_group_id
        ) {
          const { patient_id, instructor_email, simulation_group_id } =
            event.queryStringParameters;
          const { patient_name, patient_age, patient_gender, patient_prompt } =
            JSON.parse(event.body || "{}");

          if (
            patient_name != null &&
            patient_age != null &&
            patient_gender != null &&
            patient_prompt != null
          ) {
            try {
              // Check if another patient with the same name exists under the same simulation group
              const existingPatient = await sqlConnection`
                        SELECT * FROM "patients"
                        WHERE simulation_group_id = ${simulation_group_id}
                        AND patient_name = ${patient_name}
                        AND patient_id != ${patient_id};
                    `;

              if (existingPatient.length > 0) {
                response.statusCode = 400;
                response.body = JSON.stringify({
                  error: "A patient with this name already exists.",
                });
                break;
              }

              // Update the patient details in the patients table
              await sqlConnection`
                        UPDATE "patients"
                        SET 
                            patient_name = ${patient_name}, 
                            patient_age = ${patient_age}, 
                            patient_gender = ${patient_gender}, 
                            patient_prompt = ${patient_prompt}
                        WHERE patient_id = ${patient_id};
                    `;

              // Insert into User Engagement Log
              await sqlConnection`
                        INSERT INTO "user_engagement_log" (
                            log_id, 
                            user_id, 
                            simulation_group_id, 
                            patient_id, 
                            enrolment_id, 
                            timestamp, 
                            engagement_type
                        ) VALUES (
                            uuid_generate_v4(), 
                            (SELECT user_id FROM "users" WHERE user_email = ${instructor_email}),
                            ${simulation_group_id}, 
                            ${patient_id}, 
                            NULL, 
                            CURRENT_TIMESTAMP, 
                            'instructor_edited_patient'
                        );
                    `;

              response.statusCode = 200;
              response.body = JSON.stringify({
                message: "Patient updated successfully",
              });
            } catch (err) {
              response.statusCode = 500;
              console.error(err);
              response.body = JSON.stringify({
                error: "Internal server error",
              });
            }
          } else {
            response.statusCode = 400;
            response.body = JSON.stringify({
              error:
                "patient_name, patient_age, patient_gender, and patient_prompt are required in the body",
            });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error:
              "patient_id or instructor_email is missing in query string parameters",
          });
        }
        break;
      case "PUT /instructor/prompt":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.simulation_group_id &&
          event.queryStringParameters.instructor_email &&
          event.body
        ) {
          try {
            const { simulation_group_id, instructor_email } =
              event.queryStringParameters;
            const { prompt } = JSON.parse(event.body);

            // Retrieve the current system prompt
            const currentPromptResult = await sqlConnection`
              SELECT system_prompt
              FROM "simulation_groups"
              WHERE simulation_group_id = ${simulation_group_id};
            `;

            if (currentPromptResult.length === 0) {
              response.statusCode = 404;
              response.body = JSON.stringify({
                error: "Simulation Group not found",
              });
              break;
            }

            const oldPrompt = currentPromptResult[0].system_prompt;

            // Update the system prompt for the simulation group
            const updatedGroup = await sqlConnection`
              UPDATE "simulation_groups"
              SET system_prompt = ${prompt}
              WHERE simulation_group_id = ${simulation_group_id}
              RETURNING *;
            `;

            // Log the change in the User Engagement Log with the old prompt
            await sqlConnection`
              INSERT INTO "user_engagement_log" (
                log_id,
                user_id,
                simulation_group_id,
                patient_id,
                enrolment_id,
                timestamp,
                engagement_type,
                engagement_details
              )
              VALUES (
                uuid_generate_v4(),
                (SELECT user_id FROM "users" WHERE user_email = ${instructor_email}),
                ${simulation_group_id},
                null,
                null,
                CURRENT_TIMESTAMP,
                'instructor_updated_prompt',
                ${oldPrompt}
              );
            `;

            response.statusCode = 200;
            response.body = JSON.stringify(updatedGroup[0]);
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error:
              "simulation_group_id, instructor_email, or request body is missing",
          });
        }
        break;
      case "GET /instructor/view_students":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.simulation_group_id
        ) {
          const { simulation_group_id } = event.queryStringParameters;

          try {
            // Query to get all students enrolled in the given simulation group
            const enrolledStudents = await sqlConnection`
              SELECT u.user_email, u.username, u.first_name, u.last_name
              FROM "enrolments" e
              JOIN "users" u ON e.user_id = u.user_id
              WHERE e.simulation_group_id = ${simulation_group_id}
                AND e.enrolment_type = 'student';
            `;

            response.statusCode = 200;
            response.body = JSON.stringify(enrolledStudents);
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error: "simulation_group_id is required",
          });
        }
        break;
      case "DELETE /instructor/delete_student":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.simulation_group_id &&
          event.queryStringParameters.instructor_email &&
          event.queryStringParameters.user_email
        ) {
          const { simulation_group_id, instructor_email, user_email } =
            event.queryStringParameters;

          try {
            // Step 1: Get the user ID from the user email
            const userResult = await sqlConnection`
              SELECT user_id
              FROM "users"
              WHERE user_email = ${user_email}
              LIMIT 1;
            `;

            const userId = userResult[0]?.user_id;

            if (!userId) {
              response.statusCode = 404;
              response.body = JSON.stringify({
                error: "User not found",
              });
              break;
            }

            // Step 2: Delete the student from the simulation group enrolments
            const deleteResult = await sqlConnection`
              DELETE FROM "enrolments"
              WHERE simulation_group_id = ${simulation_group_id}
                AND user_id = ${userId}
                AND enrolment_type = 'student'
              RETURNING *;
            `;

            if (deleteResult.length > 0) {
              response.statusCode = 200;
              response.body = JSON.stringify(deleteResult[0]);

              // Step 3: Insert into User Engagement Log
              await sqlConnection`
                INSERT INTO "user_engagement_log" (
                  log_id, user_id, simulation_group_id, patient_id, enrolment_id, timestamp, engagement_type
                )
                VALUES (
                  uuid_generate_v4(), ${userId}, ${simulation_group_id}, null, null, 
                  CURRENT_TIMESTAMP, 'instructor_deleted_student'
                );
              `;
            } else {
              response.statusCode = 404;
              response.body = JSON.stringify({
                error: "Student not found in the simulation group",
              });
            }
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error:
              "simulation_group_id, user_email, and instructor_email are required",
          });
        }
        break;
      case "GET /instructor/view_patients":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.simulation_group_id
        ) {
          const { simulation_group_id } = event.queryStringParameters;

          try {
            // Query to get all patients for the given simulation group
            const simulationPatients = await sqlConnection`
                    SELECT p.patient_id, p.patient_name, p.patient_age, p.patient_gender, p.patient_prompt, p.llm_completion
                    FROM "patients" p
                    WHERE p.simulation_group_id = ${simulation_group_id}
                    ORDER BY p.patient_name ASC;
                `;

            response.statusCode = 200;
            response.body = JSON.stringify(simulationPatients);
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error: "simulation_group_id is required",
          });
        }
        break;
      case "DELETE /instructor/delete_patient":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.patient_id
        ) {
          const patientId = event.queryStringParameters.patient_id;

          try {
            // Delete the patient from the patients table
            await sqlConnection`
                    DELETE FROM "patients"
                    WHERE patient_id = ${patientId};
                `;

            response.statusCode = 200;
            response.body = JSON.stringify({
              message: "Patient deleted successfully",
            });
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({ error: "patient_id is required" });
        }
        break;
      case "GET /instructor/get_prompt":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.simulation_group_id
        ) {
          try {
            const { simulation_group_id } = event.queryStringParameters;

            // Retrieve the system prompt from the simulation_groups table
            const groupPrompt = await sqlConnection`
              SELECT system_prompt
              FROM "simulation_groups"
              WHERE simulation_group_id = ${simulation_group_id};
            `;

            if (groupPrompt.length > 0) {
              response.statusCode = 200;
              response.body = JSON.stringify(groupPrompt[0]);
            } else {
              response.statusCode = 404;
              response.body = JSON.stringify({
                error: "Simulation group not found",
              });
            }
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = "simulation_group_id is missing";
        }
        break;
      case "GET /instructor/view_student_messages":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.student_email &&
          event.queryStringParameters.simulation_group_id
        ) {
          const studentEmail = event.queryStringParameters.student_email;
          const simulationGroupId =
            event.queryStringParameters.simulation_group_id;

          try {
            // Step 1: Get the user ID from the user email
            const userResult = await sqlConnection`
              SELECT user_id
              FROM "users"
              WHERE user_email = ${studentEmail}
              LIMIT 1;
            `;

            const userId = userResult[0]?.user_id;

            if (!userId) {
              response.statusCode = 404;
              response.body = JSON.stringify({ error: "User not found" });
              break;
            }

            // Step 2: Query to get the student's messages for a specific simulation group
            const messages = await sqlConnection`
              SELECT m.message_content, m.time_sent, m.student_sent
              FROM "messages" m
              JOIN "sessions" s ON m.session_id = s.session_id
              JOIN "student_interactions" sp ON s.student_interaction_id = sp.student_interaction_id
              JOIN "enrolments" e ON sp.enrolment_id = e.enrolment_id
              WHERE e.user_id = ${userId}
              AND e.simulation_group_id = ${simulationGroupId}
              ORDER BY m.time_sent;
            `;

            response.statusCode = 200;
            response.body = JSON.stringify(messages);
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error: "student_email and simulation_group_id are required",
          });
        }
        break;
      case "PUT /instructor/generate_access_code":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.simulation_group_id
        ) {
          const simulationGroupId =
            event.queryStringParameters.simulation_group_id;

          try {
            const newAccessCode = generateAccessCode();

            // Update the access code in the simulation_groups table
            const updatedGroup = await sqlConnection`
              UPDATE "simulation_groups"
              SET group_access_code = ${newAccessCode}
              WHERE simulation_group_id = ${simulationGroupId}
              RETURNING *;
            `;

            response.statusCode = 200;
            response.body = JSON.stringify({
              message: "Access code generated successfully",
              access_code: newAccessCode,
            });
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error: "simulation_group_id is required",
          });
        }
        break;
      case "GET /instructor/get_access_code":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.simulation_group_id
        ) {
          const simulationGroupId =
            event.queryStringParameters.simulation_group_id;

          try {
            // Query to get the access code
            const accessCode = await sqlConnection`
              SELECT group_access_code
              FROM "simulation_groups"
              WHERE simulation_group_id = ${simulationGroupId};
            `;

            response.statusCode = 200;
            response.body = JSON.stringify(accessCode[0]);
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error: "simulation_group_id is required",
          });
        }
        break;
      case "GET /instructor/previous_prompts":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.simulation_group_id &&
          event.queryStringParameters.instructor_email
        ) {
          try {
            const { simulation_group_id, instructor_email } =
              event.queryStringParameters;

            // Query to get all previous prompts for the given simulation group and instructor
            const previousPrompts = await sqlConnection`
              SELECT timestamp, engagement_details AS previous_prompt
              FROM "user_engagement_log"
              WHERE simulation_group_id = ${simulation_group_id}
                AND engagement_type = 'instructor_updated_prompt'
              ORDER BY timestamp DESC;
            `;

            response.body = JSON.stringify(previousPrompts);
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error:
              "simulation_group_id or instructor_email query parameter is required",
          });
        }
        break;
      case "GET /instructor/student_patients_messages":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.student_email &&
          event.queryStringParameters.simulation_group_id
        ) {
          const studentEmail = event.queryStringParameters.student_email;
          const simulationGroupId =
            event.queryStringParameters.simulation_group_id;

          try {
            // Step 1: Get the user ID from the student email
            const userResult = await sqlConnection`
                    SELECT user_id
                    FROM "users"
                    WHERE user_email = ${studentEmail}
                    LIMIT 1;
                `;

            const userId = userResult[0]?.user_id;

            if (!userId) {
              response.statusCode = 404;
              response.body = JSON.stringify({
                error: "Student not found",
              });
              break;
            }

            // Step 2: Get all patients linked to the student under the given simulation group
            const studentPatients = await sqlConnection`
                    SELECT p.patient_id, p.patient_name, p.patient_number
                    FROM "student_interactions" si
                    JOIN "patients" p ON si.patient_id = p.patient_id
                    JOIN "enrolments" e ON si.enrolment_id = e.enrolment_id
                    WHERE e.user_id = ${userId} AND e.simulation_group_id = ${simulationGroupId}
                    ORDER BY p.patient_number;
                `;

            const result = {};

            // Step 3: Iterate through the patients and get sessions for each patient
            for (const patient of studentPatients) {
              const sessions = await sqlConnection`
                        SELECT s.session_id, s.session_name, s.notes
                        FROM "sessions" s
                        WHERE s.student_interaction_id IN (
                            SELECT student_interaction_id 
                            FROM "student_interactions"
                            WHERE patient_id = ${patient.patient_id} AND enrolment_id IN (
                                SELECT enrolment_id 
                                FROM "enrolments" 
                                WHERE user_id = ${userId} AND simulation_group_id = ${simulationGroupId}
                            )
                        );
                    `;

              result[patient.patient_name] = [];

              // Step 4: For each session, retrieve the messages and notes
              for (const session of sessions) {
                const messages = await sqlConnection`
                            SELECT student_sent, message_content, time_sent
                            FROM "messages"
                            WHERE session_id = ${session.session_id}
                            ORDER BY time_sent ASC;
                        `;

                result[patient.patient_name].push({
                  sessionName: session.session_name,
                  notes: session.notes || "No notes available.",
                  messages: messages.map((msg) => ({
                    student_sent: msg.student_sent,
                    message_content: msg.message_content,
                    time_sent: msg.time_sent,
                  })),
                });
              }
            }

            // Step 5: Return the response
            response.body = JSON.stringify(result);
          } catch (err) {
            console.error(err);
            response.statusCode = 500;
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error: "student_email and simulation_group_id are required",
          });
        }
        break;
      case "GET /instructor/get_completion_status":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.student_email &&
          event.queryStringParameters.simulation_group_id
        ) {
          const { student_email, simulation_group_id } =
            event.queryStringParameters;

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
          response.body = JSON.stringify({
            error: "student_email and simulation_group_id are required",
          });
        }
        break;
      case "PUT /instructor/toggle_completion":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.student_interaction_id
        ) {
          const { student_interaction_id } = event.queryStringParameters;

          try {
            // Get the current completion status
            const result = await sqlConnection`
              SELECT is_completed FROM "student_interactions" WHERE student_interaction_id = ${student_interaction_id};
            `;

            if (result.length > 0) {
              const newStatus = !result[0].is_completed;

              // Update the status to the opposite value
              await sqlConnection`
                UPDATE "student_interactions"
                SET is_completed = ${newStatus}
                WHERE student_interaction_id = ${student_interaction_id};
              `;

              response.statusCode = 200;
              response.body = JSON.stringify({
                message: "Completion status updated",
                is_completed: newStatus,
              });
            } else {
              response.statusCode = 404;
              response.body = JSON.stringify({
                error: "Interaction not found",
              });
            }
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error: "student_interaction_id is required",
          });
        }
        break;
      case "PUT /instructor/toggle_llm_completion":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.patient_id
        ) {
          const { patient_id } = event.queryStringParameters;

          try {
            // Retrieve the current llm_completion status for the patient
            const result = await sqlConnection`
                    SELECT llm_completion FROM "patients" WHERE patient_id = ${patient_id};
                `;

            if (result.length > 0) {
              // Toggle the llm_completion value
              const newStatus = !result[0].llm_completion;

              // Update the status to the opposite value in the database
              await sqlConnection`
                        UPDATE "patients"
                        SET llm_completion = ${newStatus}
                        WHERE patient_id = ${patient_id};
                    `;

              response.statusCode = 200;
              response.body = JSON.stringify({
                message: "LLM completion status updated",
                llm_completion: newStatus,
              });
            } else {
              response.statusCode = 404;
              response.body = JSON.stringify({ error: "Patient not found" });
            }
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({ error: "patient_id is required" });
        }
        break;
      case "GET /instructor/ingestion_status":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.patient_id &&
          event.queryStringParameters.simulation_group_id
        ) {
          const { patient_id, simulation_group_id } =
            event.queryStringParameters;

          try {
            // Query patient_data table to fetch filenames and ingestion_status for documents
            const ingestionStatusData = await sqlConnection`
                    SELECT filename, filetype, ingestion_status
                    FROM "patient_data"
                    WHERE patient_id = ${patient_id}
                    AND filepath LIKE ${
                      simulation_group_id + "/" + patient_id + "/documents/%"
                    };
                `;

            // Convert the results to a hashmap
            const ingestionStatusMap = {};
            ingestionStatusData.forEach((row) => {
              ingestionStatusMap[row.filename + "." + row.filetype] =
                row.ingestion_status;
            });

            response.statusCode = 200;
            response.body = JSON.stringify(ingestionStatusMap);
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error: "patient_id and simulation_group_id are required",
          });
        }
        break;
      case "GET /instructor/empathy_summary":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.student_email &&
          event.queryStringParameters.simulation_group_id
        ) {
          const { student_email, simulation_group_id, patient_id } =
            event.queryStringParameters;

          try {
            // Get user_id from student email
            const userResult = await sqlConnection`
              SELECT user_id FROM "users" WHERE user_email = ${student_email} LIMIT 1;
            `;

            const userId = userResult[0]?.user_id;
            if (!userId) {
              response.statusCode = 404;
              response.body = JSON.stringify({ error: "Student not found" });
              break;
            }

            // Check if empathy_evaluation column exists and get data
            let empathyData = [];
            try {
              // First check if column exists
              const columnCheck = await sqlConnection`
                SELECT column_name FROM information_schema.columns 
                WHERE table_name = 'messages' AND column_name = 'empathy_evaluation';
              `;

              if (columnCheck.length === 0) {
                console.log(
                  "empathy_evaluation column does not exist in messages table"
                );
                response.statusCode = 200;
                response.body = JSON.stringify({
                  overall_score: 0,
                  overall_level: "No Data",
                  total_interactions: 0,
                  empathy_interactions: 0,
                  avg_perspective_taking: 0,
                  avg_emotional_resonance: 0,
                  avg_acknowledgment: 0,
                  avg_language_communication: 0,
                  avg_cognitive_empathy: 0,
                  avg_affective_empathy: 0,
                  summary:
                    "Empathy evaluation feature not yet available. Database schema needs to be updated.",
                });
                break;
              }

              // Column exists, try to get data
              if (patient_id) {
                // If patient_id is provided, filter by that specific patient
                empathyData = await sqlConnection`
                  SELECT m.empathy_evaluation
                  FROM "messages" m
                  JOIN "sessions" s ON m.session_id = s.session_id
                  JOIN "student_interactions" si ON s.student_interaction_id = si.student_interaction_id
                  JOIN "enrolments" e ON si.enrolment_id = e.enrolment_id
                  JOIN "patients" p ON si.patient_id = p.patient_id
                  WHERE e.user_id = ${userId}
                  AND e.simulation_group_id = ${simulation_group_id}
                  AND p.patient_id = ${patient_id}
                  AND m.student_sent = true
                  AND m.empathy_evaluation IS NOT NULL;
                `;
              } else {
                // If no patient_id, get all empathy data for the student in this simulation group
                // This retrieves empathy evaluations from messages where students have interacted with patients
                // The data includes perspective-taking, emotional resonance, acknowledgment, and communication scores
                empathyData = await sqlConnection`
                  SELECT m.empathy_evaluation
                  FROM "messages" m
                  JOIN "sessions" s ON m.session_id = s.session_id
                  JOIN "student_interactions" si ON s.student_interaction_id = si.student_interaction_id
                  JOIN "enrolments" e ON si.enrolment_id = e.enrolment_id
                  WHERE e.user_id = ${userId}
                  AND e.simulation_group_id = ${simulation_group_id}
                  AND m.student_sent = true
                  AND m.empathy_evaluation IS NOT NULL;
                `;
              }
            } catch (error) {
              console.error("Error querying empathy data:", error);
              response.statusCode = 500;
              response.body = JSON.stringify({
                error: "Database query failed: " + error.message,
              });
              break;
            }

            if (!empathyData || empathyData.length === 0) {
              response.statusCode = 200;
              response.body = JSON.stringify({
                overall_score: 0,
                overall_level: "No Data",
                total_interactions: 0,
                empathy_interactions: 0,
                avg_perspective_taking: 0,
                avg_emotional_resonance: 0,
                avg_acknowledgment: 0,
                avg_language_communication: 0,
                avg_cognitive_empathy: 0,
                avg_affective_empathy: 0,
                summary:
                  "No empathy evaluation data available for this student.",
              });
              break;
            }

            // Calculate averages
            let totalScore = 0,
              totalPT = 0,
              totalER = 0,
              totalAck = 0,
              totalLang = 0,
              totalCog = 0,
              totalAff = 0;
            let validCount = 0;

            empathyData.forEach((row) => {
              const evaluation = row.empathy_evaluation;
              if (evaluation && typeof evaluation === "object") {
                totalScore += evaluation.empathy_score || 0;
                totalPT += evaluation.perspective_taking || 0;
                totalER += evaluation.emotional_resonance || 0;
                totalAck += evaluation.acknowledgment || 0;
                totalLang += evaluation.language_communication || 0;
                totalCog += evaluation.cognitive_empathy || 0;
                totalAff += evaluation.affective_empathy || 0;
                validCount++;
              }
            });

            const avgScore =
              validCount > 0 ? (totalScore / validCount).toFixed(1) : 0;
            const avgPT =
              validCount > 0 ? (totalPT / validCount).toFixed(1) : 0;
            const avgER =
              validCount > 0 ? (totalER / validCount).toFixed(1) : 0;
            const avgAck =
              validCount > 0 ? (totalAck / validCount).toFixed(1) : 0;
            const avgLang =
              validCount > 0 ? (totalLang / validCount).toFixed(1) : 0;
            const avgCog =
              validCount > 0 ? (totalCog / validCount).toFixed(1) : 0;
            const avgAff =
              validCount > 0 ? (totalAff / validCount).toFixed(1) : 0;

            // Determine overall level
            const getLevel = (score) => {
              if (score >= 4.5) return "Extending";
              if (score >= 3.5) return "Proficient";
              if (score >= 2.5) return "Competent";
              if (score >= 1.5) return "Advanced Beginner";
              return "Novice";
            };

            // Generate summary
            const overallLevel = getLevel(parseFloat(avgScore));

            // Determine strongest areas
            const strengths = [
              avgPT >= 3.5 ? "perspective-taking" : "",
              avgER >= 3.5 ? "emotional resonance" : "",
              avgAck >= 3.5 ? "patient acknowledgment" : "",
              avgLang >= 3.5 ? "communication language" : "",
            ]
              .filter(Boolean)
              .join(", ");

            // Determine areas for development
            const weaknesses = [
              avgPT < 3.5 ? "perspective-taking" : "",
              avgER < 3.5 ? "emotional resonance" : "",
              avgAck < 3.5 ? "patient acknowledgment" : "",
              avgLang < 3.5 ? "communication clarity" : "",
            ]
              .filter(Boolean)
              .join(", ");

            // Determine empathy profile
            let empathySummary = "";
            if (avgCog === avgAff) {
              empathySummary =
                avgCog >= 3.5
                  ? "a balanced and strong mix of cognitive (understanding) and affective (emotional connection) empathy"
                  : "a balanced but limited expression of both cognitive and affective empathy";
            } else {
              empathySummary =
                avgCog > avgAff
                  ? "stronger cognitive empathy (understanding)"
                  : "stronger affective empathy (emotional connection)";
            }

            // Final summary string
            const summary =
              `This student demonstrates ${overallLevel.toLowerCase()} empathetic communication skills with an average score of ${avgScore}/5. ` +
              (strengths ? `Strongest areas include ${strengths}. ` : "") +
              (weaknesses ? `Areas for development: ${weaknesses}. ` : "") +
              `The student shows ${empathySummary} in their interactions.`;

            // Get total interactions count
            let totalInteractions;
            if (patient_id) {
              totalInteractions = await sqlConnection`
                SELECT COUNT(*) as count
                FROM "messages" m
                JOIN "sessions" s ON m.session_id = s.session_id
                JOIN "student_interactions" si ON s.student_interaction_id = si.student_interaction_id
                JOIN "enrolments" e ON si.enrolment_id = e.enrolment_id
                JOIN "patients" p ON si.patient_id = p.patient_id
                WHERE e.user_id = ${userId}
                AND e.simulation_group_id = ${simulation_group_id}
                AND p.patient_id = ${patient_id}
                AND m.student_sent = true;
              `;
            } else {
              totalInteractions = await sqlConnection`
                SELECT COUNT(*) as count
                FROM "messages" m
                JOIN "sessions" s ON m.session_id = s.session_id
                JOIN "student_interactions" si ON s.student_interaction_id = si.student_interaction_id
                JOIN "enrolments" e ON si.enrolment_id = e.enrolment_id
                WHERE e.user_id = ${userId}
                AND e.simulation_group_id = ${simulation_group_id}
                AND m.student_sent = true;
              `;
            }

            // Get patient name if patient_id is provided
            let patientName = null;
            if (patient_id) {
              const patientData = await sqlConnection`
                SELECT patient_name FROM "patients" WHERE patient_id = ${patient_id};
              `;
              if (patientData.length > 0) {
                patientName = patientData[0].patient_name;
              }
            }

            response.statusCode = 200;
            response.body = JSON.stringify({
              overall_score: parseFloat(avgScore),
              overall_level: overallLevel,
              total_interactions: parseInt(totalInteractions[0].count),
              empathy_interactions: validCount,
              avg_perspective_taking: parseFloat(avgPT),
              avg_emotional_resonance: parseFloat(avgER),
              avg_acknowledgment: parseFloat(avgAck),
              avg_language_communication: parseFloat(avgLang),
              avg_cognitive_empathy: parseFloat(avgCog),
              avg_affective_empathy: parseFloat(avgAff),
              summary: summary.replace(/,\s*$/, ".").replace(/,\s*\./g, "."),
              patient_name: patientName,
            });
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error: "student_email and simulation_group_id are required",
          });
        }
        break;
      default:
        throw new Error(`Unsupported route: "${pathData}"`);
    }
  } catch (error) {
    response.statusCode = 400;
    response.body = JSON.stringify(error.message);
  }
  console.log(response);

  return response;
};
