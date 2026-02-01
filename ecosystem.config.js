module.exports = {
  apps: [
    {
      name: 'mqtt-bridge',
      cwd: './mqtt-bridge',
      script: 'index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      error_file: './logs/mqtt-bridge-error.log',
      out_file: './logs/mqtt-bridge-out.log',
      time: true,
      merge_logs: true,
    },
    {
      name: 'mqtt-subscriber',
      cwd: './mqtt-subscriber',
      script: 'index.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '200M',
      error_file: './logs/mqtt-subscriber-error.log',
      out_file: './logs/mqtt-subscriber-out.log',
      time: true,
      merge_logs: true,
    }
  ],

  deploy: {
    production: {
      user: 'yihan',
      host: 'yh.mated.dev',
      ref: 'origin/main',
      repo: 'git@github.com:cotghw/monkey-muaythai-MQTT.git',
      path: '/home/yihan/working-base/yihan/monkey-muaythai/MQTT',
      'post-deploy': 'source ~/.nvm/nvm.sh && nvm use 22 && cd mqtt-bridge && npm install && cd ../mqtt-subscriber && npm install && cd .. && pm2 startOrRestart ecosystem.config.js',
      ssh_options: 'StrictHostKeyChecking=no -p 22023',
    },
  },
};
