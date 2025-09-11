exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS patients (
      patient_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      simulation_group_id uuid REFERENCES simulation_groups(simulation_group_id) ON DELETE CASCADE ON UPDATE CASCADE,
      patient_name varchar,
      patient_age integer,
      patient_gender varchar,
      patient_number integer,
      patient_prompt text,
      llm_completion boolean DEFAULT true,
      voice_id varchar DEFAULT 'tiffany'
    )
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("patients");
};