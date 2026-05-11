module.exports = {
  apps: [
    {
      name: 'nexus-server',
      script: './server/index.js',
      cwd: __dirname,
      env: {
        NODE_ENV: 'production',
        NEXUS_PORT: 47900,
      },
      log_file: './logs/server.log',
      error_file: './logs/server-error.log',
      out_file: './logs/server-out.log',
      merge_logs: true,
      max_restarts: 10,
      restart_delay: 2000,
      watch: false,
    },
    {
      name: 'nexus-watcher',
      script: './graph/watcher.js',
      cwd: __dirname,
      log_file: './logs/watcher.log',
      error_file: './logs/watcher-error.log',
      max_restarts: 5,
      restart_delay: 5000,
      watch: false,
    },
    {
      name: 'nexus-observer',
      script: './core/observer.js',
      cwd: __dirname,
      log_file: './logs/observer.log',
      error_file: './logs/observer-error.log',
      max_restarts: 5,
      restart_delay: 10000,
      watch: false,
      env: {
        NEXUS_OBSERVER_INTERVAL: '30000',
      },
    },
  ],
};
