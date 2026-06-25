/**
 * pm2 process descriptor for the Clicker worker daemon.
 *
 * Deploy on the droplet with:
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *   pm2 startup    # follow the printed command to enable boot-time start
 *
 * Logs:
 *   pm2 logs clicker-worker
 */
module.exports = {
  apps: [
    {
      name: "clicker-worker",
      script: "npm",
      args: "run worker",
      cwd: "/opt/clicker-dashboard",
      // Auto-restart on crash with backoff so a bad bug doesn't melt the CPU.
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      // Memory cap: if the worker hits this, pm2 restarts it.
      max_memory_restart: "500M",
      // Capture both stdout and stderr to the same merged log.
      merge_logs: true,
      out_file: "/var/log/clicker-worker.out.log",
      error_file: "/var/log/clicker-worker.err.log",
      time: true,
      env: {
        NODE_ENV: "production",
      },
    },
  ],
};
