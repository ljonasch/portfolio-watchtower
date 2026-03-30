const path = require("path");

module.exports = {
  apps: [
    {
      name: "Portfolio-Watchtower-Scheduler",
      script: path.join(__dirname, "scripts", "watchtower-scheduler.ts"),
      interpreter: "node",
      interpreter_args: "--import tsx/esm",
      cwd: __dirname,
      env: {
        NODE_ENV: "development",
        FORCE_COLOR: "0",
      },
      min_uptime: "5s",
      max_restarts: 20,
      log_file: path.join(__dirname, "logs", "scheduler.log"),
      error_file: path.join(__dirname, "logs", "scheduler-error.log"),
      time: true,
      watch: false,
    },
  ],
};
