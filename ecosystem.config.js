module.exports = {
  apps: [
    {
      name: 'nizoai-bot',
      script: 'dist/index.js',
      cwd: '/root/bot',
      env_file: '/root/bot/.env',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      restart_delay: 3000,
      exp_backoff_restart_delay: 100,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      error_file: '/root/bot/logs/error.log',
      out_file: '/root/bot/logs/out.log',
      merge_logs: true,
    },
  ],
};
