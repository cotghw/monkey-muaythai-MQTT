module.exports = {
  apps: [
    {
      name: 'mqtt-bridge',
      cwd: './mqtt-bridge',
      script: 'index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M'
    },
    {
      name: 'mqtt-subscriber',
      cwd: './mqtt-subscriber',
      script: 'index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M'
    }
  ]
};
