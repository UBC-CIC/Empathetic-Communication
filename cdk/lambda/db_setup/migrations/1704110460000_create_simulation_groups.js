exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS simulation_groups (
      simulation_group_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      group_name varchar,
      group_description varchar,
      group_access_code varchar,
      group_student_access boolean,
      system_prompt text,
      empathy_enabled boolean NOT NULL DEFAULT false
    )
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("simulation_groups");
};