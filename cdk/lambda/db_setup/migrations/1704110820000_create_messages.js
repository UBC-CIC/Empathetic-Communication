exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS messages (
      message_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      session_id uuid REFERENCES sessions(session_id) ON DELETE CASCADE ON UPDATE CASCADE,
      student_sent boolean,
      message_content varchar,
      time_sent timestamp,
      empathy_evaluation jsonb DEFAULT '{}'
    )
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("messages");
};