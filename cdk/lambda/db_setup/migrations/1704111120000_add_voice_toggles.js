exports.up = (pgm) => {
  pgm.addColumns('simulation_groups', {
    admin_voice_enabled: {
      type: 'boolean',
      default: true
    },
    instructor_voice_enabled: {
      type: 'boolean',
      default: true
    }
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('simulation_groups', ['admin_voice_enabled', 'instructor_voice_enabled']);
};