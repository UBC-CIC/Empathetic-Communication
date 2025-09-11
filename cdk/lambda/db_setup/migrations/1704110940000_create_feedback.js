exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS feedback (
      feedback_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      session_id uuid REFERENCES sessions(session_id) ON DELETE CASCADE ON UPDATE CASCADE,
      score integer,
      analysis text,
      areas_for_improvement varchar[],
      submitted_at timestamp DEFAULT CURRENT_TIMESTAMP
    )
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("feedback");
};