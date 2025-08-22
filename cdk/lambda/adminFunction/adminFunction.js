const { initializeConnection } = require("./libadmin.js");

let { SM_DB_CREDENTIALS, RDS_PROXY_ENDPOINT } = process.env;

// SQL conneciton from global variable at libadmin.js
let sqlConnectionTableCreator = global.sqlConnectionTableCreator;

exports.handler = async (event) => {
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
  if (!sqlConnectionTableCreator) {
    await initializeConnection(SM_DB_CREDENTIALS, RDS_PROXY_ENDPOINT);
    sqlConnectionTableCreator = global.sqlConnectionTableCreator;
  }

  // Function to format student full names (lowercase and spaces replaced with "_")
  const formatNames = (name) => {
    return name.toLowerCase().replace(/\s+/g, "_");
  };

  let data;
  try {
    const pathData = event.httpMethod + " " + event.resource;
    switch (pathData) {
      case "GET /admin/instructors":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.instructor_email
        ) {
          const { instructor_email } = event.queryStringParameters;

          // SQL query to fetch all users who are instructors
          const instructors = await sqlConnectionTableCreator`
                SELECT user_email, first_name, last_name
                FROM "users"
                WHERE roles @> ARRAY['instructor']::varchar[]
                ORDER BY last_name ASC;
              `;

          response.body = JSON.stringify(instructors);
        } else {
          response.statusCode = 400;
          response.body = "instructor_email is required";
        }
        break;
      case "GET /admin/simulation_groups":
        try {
          // Query all simulation groups from simulation_groups table
          const simulationGroups = await sqlConnectionTableCreator`
                    SELECT *
                    FROM "simulation_groups";
                `;

          response.body = JSON.stringify(simulationGroups);
        } catch (err) {
          response.statusCode = 500;
          response.body = JSON.stringify({ error: "Internal server error" });
        }
        break;
        case "POST /admin/enroll_instructor":
          if (
            event.queryStringParameters != null &&
            event.queryStringParameters.simulation_group_id &&
            event.queryStringParameters.instructor_email
          ) {
            try {
              const { simulation_group_id, instructor_email } = event.queryStringParameters;
      
              // Retrieve user_id from users table based on the instructor email
              const userResult = await sqlConnectionTableCreator`
                  SELECT user_id
                  FROM "users"
                  WHERE user_email = ${instructor_email};
                `;
      
              const user_id = userResult[0]?.user_id;
      
              if (!user_id) {
                response.statusCode = 400;
                response.body = JSON.stringify({
                  error: "Instructor email not found",
                });
                break;
              }
      
              // Insert enrollment into enrolments table with current timestamp for the 'instructor' role
              const enrollment = await sqlConnectionTableCreator`
                  INSERT INTO "enrolments" (enrolment_id, simulation_group_id, user_id, enrolment_type, time_enroled)
                  VALUES (uuid_generate_v4(), ${simulation_group_id}, ${user_id}, 'instructor', CURRENT_TIMESTAMP)
                  ON CONFLICT (simulation_group_id, user_id) 
                  DO UPDATE SET 
                      enrolment_id = EXCLUDED.enrolment_id,
                      enrolment_type = EXCLUDED.enrolment_type,
                      time_enroled = EXCLUDED.time_enroled
                  RETURNING enrolment_id;
                `;
      
              const enrolment_id = enrollment[0]?.enrolment_id;
      
              if (enrolment_id) {
                // Retrieve all patient IDs associated with the simulation group
                const patientsResult = await sqlConnectionTableCreator`
                    SELECT patient_id
                    FROM "patients"
                    WHERE simulation_group_id = ${simulation_group_id};
                  `;
      
                // Insert a record into student_interactions for each patient in the simulation group
                const studentInteractionInsertions = patientsResult.map((patient) => {
                  return sqlConnectionTableCreator`
                      INSERT INTO "student_interactions" (student_interaction_id, patient_id, enrolment_id, patient_score, last_accessed, patient_context_embedding, is_completed)
                      VALUES (uuid_generate_v4(), ${patient.patient_id}, ${enrolment_id}, 0, CURRENT_TIMESTAMP, NULL, FALSE);
                    `;
                });
      
                // Execute all insertions
                await Promise.all(studentInteractionInsertions);
              }
      
              response.body = JSON.stringify({
                message: "Instructor enrolled and patients linked successfully.",
              });
      
              // Optionally insert into User Engagement Log (uncomment if needed)
              // await sqlConnectionTableCreator`
              //   INSERT INTO "user_engagement_log" (log_id, user_id, simulation_group_id, patient_id, enrolment_id, timestamp, engagement_type)
              //   VALUES (uuid_generate_v4(), ${user_id}, ${simulation_group_id}, null, ${enrolment_id}, CURRENT_TIMESTAMP, 'enrollment_created');
              // `;
            } catch (err) {
              response.statusCode = 500;
              console.log(err);
              response.body = JSON.stringify({ error: "Internal server error" });
            }
          } else {
            response.statusCode = 400;
            response.body = "simulation_group_id and instructor_email are required";
          }
          break;
      case "POST /admin/create_simulation_group":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.group_name &&
          event.queryStringParameters.group_access_code &&
          event.queryStringParameters.group_description &&
          event.queryStringParameters.group_student_access &&
          event.body
        ) {
          try {
            console.log("simulation group creation start");
            const {
              group_name,
              group_access_code,
              group_description,
              group_student_access,
            } = event.queryStringParameters;
      
            const { system_prompt } = JSON.parse(event.body);
      
            // Insert new simulation group into simulation_groups table
            const newSimulationGroup = await sqlConnectionTableCreator`
                  INSERT INTO "simulation_groups" (
                      simulation_group_id,
                      group_name,
                      group_description,
                      group_access_code,
                      group_student_access,
                      system_prompt
                  )
                  VALUES (
                      uuid_generate_v4(),
                      ${group_name},
                      ${group_description}, -- optional, can be null if not provided
                      ${group_access_code},
                      ${group_student_access.toLowerCase() === "true"},
                      ${system_prompt}
                  )
                  RETURNING *;
              `;
      
            response.body = JSON.stringify(newSimulationGroup[0]);
          } catch (err) {
            response.statusCode = 500;
            console.log(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = "Missing required parameters";
        }
        break;
      case "GET /admin/groupInstructors":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.simulation_group_id
        ) {
          const { simulation_group_id } = event.queryStringParameters;

          // SQL query to fetch all instructors for a given group
          const instructors = await sqlConnectionTableCreator`
              SELECT u.user_email, u.first_name, u.last_name
              FROM "enrolments" e
              JOIN "users" u ON e.user_id = u.user_id
              WHERE e.simulation_group_id = ${simulation_group_id} AND e.enrolment_type = 'instructor';
            `;

          response.body = JSON.stringify(instructors);
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({ error: "simulation_group_id is required" });
        }
        break;
      case "GET /admin/instructorGroups":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.instructor_email
        ) {
          const { instructor_email } = event.queryStringParameters;

          // SQL query to fetch all groups for a given instructor
          const groups = await sqlConnectionTableCreator`
              SELECT g.simulation_group_id, g.group_name, g.group_description
              FROM "enrolments" e
              JOIN "simulation_groups" g ON e.simulation_group_id = g.simulation_group_id
              JOIN "users" u ON e.user_id = u.user_id
              WHERE u.user_email = ${instructor_email} AND e.enrolment_type = 'instructor';
            `;

          response.body = JSON.stringify(groups);
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error: "instructor_email is required",
          });
        }
        break;
      case "POST /admin/updateGroupAccess":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.simulation_group_id &&
          event.queryStringParameters.access
        ) {
          const { simulation_group_id, access } = event.queryStringParameters;
          const accessBool = access.toLowerCase() === "true";

          // SQL query to update group access
          await sqlConnectionTableCreator`
                    UPDATE "simulation_groups"
                    SET group_student_access = ${accessBool}
                    WHERE simulation_group_id = ${simulation_group_id};
                  `;

          response.body = JSON.stringify({
            message: "Group access updated successfully.",
          });
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error: "simulation_group_id and access query parameters are required",
          });
        }
        break;
      case "DELETE /admin/delete_instructor_enrolments":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.instructor_email
        ) {
          try {
            const { instructor_email } = event.queryStringParameters;

            // Retrieve the user's ID
            const userResult = await sqlConnectionTableCreator`
                        SELECT user_id 
                        FROM "users"
                        WHERE user_email = ${instructor_email};
                    `;

            const userId = userResult[0]?.user_id;

            if (!userId) {
              response.statusCode = 404;
              response.body = JSON.stringify({ error: "Instructor not found" });
              return;
            }

            // Delete all enrolments for the instructor
            await sqlConnectionTableCreator`
                        DELETE FROM "enrolments"
                        WHERE user_id = ${userId} AND enrolment_type = 'instructor';
                    `;

            response.body = JSON.stringify({
              message: "Instructor enrolments deleted successfully.",
            });
          } catch (err) {
            await sqlConnectionTableCreator.rollback();
            response.statusCode = 500;
            console.log(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = "instructor_email query parameter is required";
        }
        break;
      case "DELETE /admin/delete_group_instructor_enrolments":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.simulation_group_id
        ) {
          try {
            const { simulation_group_id } = event.queryStringParameters;

            // Delete all enrolments for the group where enrolment_type is 'instructor'
            await sqlConnectionTableCreator`
                      DELETE FROM "enrolments"
                      WHERE simulation_group_id = ${simulation_group_id} AND enrolment_type = 'instructor';
                  `;

            response.body = JSON.stringify({
              message: "Group instructor enrolments deleted successfully.",
            });
          } catch (err) {
            response.statusCode = 500;
            console.log(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = "simulation_group_id query parameter is required";
        }
        break;
      case "DELETE /admin/delete_group":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.simulation_group_id
        ) {
          try {
            const { simulation_group_id } = event.queryStringParameters;

            // // Drop the table whose name is the simulation_group_id
            // await sqlConnectionTableCreator`
            //   DROP TABLE IF EXISTS ${sqlConnectionTableCreator(simulation_group_id)};
            // `;

            // Delete the group, related records will be automatically deleted due to cascading
            await sqlConnectionTableCreator`
                      DELETE FROM "simulation_groups"
                      WHERE simulation_group_id = ${simulation_group_id};
                  `;

            response.body = JSON.stringify({
              message: "Group and related records deleted successfully.",
            });
          } catch (err) {
            await sqlConnection.rollback();
            response.statusCode = 500;
            console.log(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = "simulation_group_id query parameter is required";
        }
        break;
      case "POST /admin/elevate_instructor":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.email
        ) {
          const instructorEmail = event.queryStringParameters.email;

          try {
            // Check if the user exists
            const existingUser = await sqlConnectionTableCreator`
                          SELECT * FROM "users"
                          WHERE user_email = ${instructorEmail};
                      `;

            if (existingUser.length > 0) {
              const userRoles = existingUser[0].roles;

              // Check if the role is already 'instructor' or 'admin'
              if (
                userRoles.includes("instructor") ||
                userRoles.includes("admin")
              ) {
                response.statusCode = 200;
                response.body = JSON.stringify({
                  message:
                    "No changes made. User is already an instructor or admin.",
                });
                break;
              }

              // If the role is 'student', elevate to 'instructor'
              if (userRoles.includes("student")) {
                const newRoles = userRoles.map((role) =>
                  role === "student" ? "instructor" : role
                );

                await sqlConnectionTableCreator`
                                UPDATE "users"
                                SET roles = ${newRoles}
                                WHERE user_email = ${instructorEmail};
                            `;

                response.statusCode = 200;
                response.body = JSON.stringify({
                  message: "User role updated to instructor.",
                });
                break;
              }
            } else {
              // Create a new user with the role 'instructor'
              await sqlConnectionTableCreator`
                              INSERT INTO "users" (user_email, roles)
                              VALUES (${instructorEmail}, ARRAY['instructor']);
                          `;

              response.statusCode = 201;
              response.body = JSON.stringify({
                message: "New user created and elevated to instructor.",
              });
            }
          } catch (err) {
            response.statusCode = 500;
            console.error(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({ error: "Email is required" });
        }
        break;
      case "POST /admin/lower_instructor":
        if (
          event.queryStringParameters != null &&
          event.queryStringParameters.email
        ) {
          try {
            const userEmail = event.queryStringParameters.email;

            // Fetch the roles for the user
            const userRoleData = await sqlConnectionTableCreator`
                    SELECT roles, user_id
                    FROM "users"
                    WHERE user_email = ${userEmail};
                  `;

            const userRoles = userRoleData[0]?.roles;
            const userId = userRoleData[0]?.user_id;

            if (!userRoles || !userRoles.includes("instructor")) {
              response.statusCode = 400;
              response.body = JSON.stringify({
                error: "User is not an instructor or doesn't exist",
              });
              break;
            }

            // Replace 'instructor' with 'student'
            const updatedRoles = userRoles
              .filter((role) => role !== "instructor")
              .concat("student");

            // Update the roles in the database
            await sqlConnectionTableCreator`
                    UPDATE "users"
                    SET roles = ${updatedRoles}
                    WHERE user_email = ${userEmail};
                  `;

            // Delete all enrolments where the enrolment type is instructor
            await sqlConnectionTableCreator`
                    DELETE FROM "enrolments"
                    WHERE user_id = ${userId} AND enrolment_type = 'instructor';
                  `;

            response.statusCode = 200;
            response.body = JSON.stringify({
              message: `User role updated to student for ${userEmail} and all instructor enrolments deleted.`,
            });
          } catch (err) {
            console.log(err);
            response.statusCode = 500;
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = JSON.stringify({
            error: "email query parameter is missing",
          });
        }
        break;
      case "GET /admin/system_prompts":
        try {
          // Get the latest system prompt from history table
          const latestPrompt = await sqlConnectionTableCreator`
            SELECT prompt_content, created_at
            FROM "system_prompt_history"
            ORDER BY created_at DESC
            LIMIT 1;
          `;

          // Get prompt history excluding the latest one
          const promptHistory = await sqlConnectionTableCreator`
            SELECT history_id, prompt_content, created_at
            FROM "system_prompt_history"
            ORDER BY created_at DESC
            OFFSET 1;
          `;

          response.body = JSON.stringify({
            current_prompt: latestPrompt[0]?.prompt_content || "",
            history: promptHistory
          });
        } catch (err) {
          response.statusCode = 500;
          console.log(err);
          response.body = JSON.stringify({ error: "Internal server error" });
        }
        break;
      case "POST /admin/update_system_prompt":
        if (event.body) {
          try {
            const { prompt_content } = JSON.parse(event.body);
            if (!prompt_content || !prompt_content.trim()) {
              response.statusCode = 400;
              response.body = "prompt_content is required";
              break;
            }

            // Insert new prompt into history (created_by removed)
            await sqlConnectionTableCreator`
              INSERT INTO "system_prompt_history" (prompt_content)
              VALUES (${prompt_content});
            `;

            response.body = JSON.stringify({
              message: "System prompt updated successfully"
            });
          } catch (err) {
            response.statusCode = 500;
            console.log(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = "prompt_content is required";
        }
        break;
      case "POST /admin/restore_system_prompt":
        try {
          // Prefer query param history_id; fallback to body with prompt_content for backward compatibility
          const historyId = event.queryStringParameters && event.queryStringParameters.history_id
            ? event.queryStringParameters.history_id
            : null;

          if (historyId) {
            // Fetch the prompt_content for the given history_id and insert as new active prompt
            const rows = await sqlConnectionTableCreator`
              SELECT prompt_content
              FROM "system_prompt_history"
              WHERE history_id = ${historyId}
              LIMIT 1;
            `;

            const fromHistory = rows[0]?.prompt_content;
            if (!fromHistory) {
              response.statusCode = 404;
              response.body = JSON.stringify({ error: "History entry not found" });
              break;
            }

            await sqlConnectionTableCreator`
              INSERT INTO "system_prompt_history" (prompt_content)
              VALUES (${fromHistory});
            `;

            response.body = JSON.stringify({
              message: "System prompt restored successfully"
            });
            break;
          }

          // Fallback: body-based restore (no created_by)
          if (event.body) {
            const { prompt_content } = JSON.parse(event.body);
            if (!prompt_content || !prompt_content.trim()) {
              response.statusCode = 400;
              response.body = "prompt_content is required";
              break;
            }

            await sqlConnectionTableCreator`
              INSERT INTO "system_prompt_history" (prompt_content)
              VALUES (${prompt_content});
            `;

            response.body = JSON.stringify({
              message: "System prompt restored successfully"
            });
          } else {
            response.statusCode = 400;
            response.body = "history_id or prompt_content is required";
          }
        } catch (err) {
          response.statusCode = 500;
          console.log(err);
          response.body = JSON.stringify({ error: "Internal server error" });
        }
        break;
      case "POST /admin/update_user_token_limit":
        if (event.body) {
          try {
            const { user_email, token_limit } = JSON.parse(event.body);
            if (!user_email || !token_limit || token_limit < 1000) {
              response.statusCode = 400;
              response.body = "user_email and token_limit (min 1000) are required";
              break;
            }

            await sqlConnectionTableCreator`
              UPDATE "users"
              SET token_limit = ${token_limit}
              WHERE user_email = ${user_email};
            `;

            response.body = JSON.stringify({
              message: "User token limit updated successfully"
            });
          } catch (err) {
            response.statusCode = 500;
            console.log(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = "user_email and token_limit are required";
        }
        break;
      case "POST /admin/update_all_token_limits":
        if (event.body) {
          try {
            const { token_limit } = JSON.parse(event.body);
            if (!token_limit || token_limit < 1000) {
              response.statusCode = 400;
              response.body = "token_limit (min 1000) is required";
              break;
            }

            await sqlConnectionTableCreator`
              UPDATE "users"
              SET token_limit = ${token_limit};
            `;

            response.body = JSON.stringify({
              message: "All user token limits updated successfully"
            });
          } catch (err) {
            response.statusCode = 500;
            console.log(err);
            response.body = JSON.stringify({ error: "Internal server error" });
          }
        } else {
          response.statusCode = 400;
          response.body = "token_limit is required";
        }
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
