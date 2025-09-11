exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS student_interactions (
      student_interaction_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      patient_id uuid REFERENCES patients(patient_id) ON DELETE CASCADE ON UPDATE CASCADE,
      enrolment_id uuid REFERENCES enrolments(enrolment_id) ON DELETE CASCADE ON UPDATE CASCADE,
      patient_score integer,
      last_accessed timestamp,
      patient_context_embedding float[],
      is_completed boolean DEFAULT false
    )
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("student_interactions");
};