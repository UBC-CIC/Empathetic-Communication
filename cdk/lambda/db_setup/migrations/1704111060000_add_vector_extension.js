exports.up = (pgm) => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS "vector"');
};

exports.down = (pgm) => {
  pgm.dropExtension("vector", { ifExists: true });
};