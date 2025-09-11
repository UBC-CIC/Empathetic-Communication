exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS user_engagement_log (
      log_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      user_id uuid REFERENCES users(user_id) ON DELETE CASCADE ON UPDATE CASCADE,
      simulation_group_id uuid REFERENCES simulation_groups(simulation_group_id) ON DELETE CASCADE ON UPDATE CASCADE,
      patient_id uuid REFERENCES patients(patient_id) ON DELETE CASCADE ON UPDATE CASCADE,
      enrolment_id uuid REFERENCES enrolments(enrolment_id) ON DELETE CASCADE ON UPDATE CASCADE,
      timestamp timestamp,
      engagement_type varchar,
      engagement_details text
    )
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("user_engagement_log");
};