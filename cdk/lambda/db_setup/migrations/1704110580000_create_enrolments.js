exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS enrolments (
      enrolment_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id uuid REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
      simulation_group_id uuid REFERENCES simulation_groups(simulation_group_id) ON DELETE CASCADE ON UPDATE CASCADE,
      enrolment_type varchar,
      group_completion_percentage integer,
      time_enroled timestamp,
      UNIQUE(simulation_group_id, user_id)
    )
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("enrolments");
};