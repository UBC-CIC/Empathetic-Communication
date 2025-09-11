exports.up = (pgm) => {
  pgm.sql(`
    CREATE TABLE IF NOT EXISTS patient_data (
      file_id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
      patient_id uuid REFERENCES patients(patient_id) ON DELETE CASCADE ON UPDATE CASCADE,
      filetype varchar,
      s3_bucket_reference varchar,
      filepath varchar,
      filename varchar,
      time_uploaded timestamp,
      metadata text,
      file_number integer,
      ingestion_status varchar(20) DEFAULT 'not processing'
    )
  `);
};

exports.down = (pgm) => {
  pgm.dropTable("patient_data");
};