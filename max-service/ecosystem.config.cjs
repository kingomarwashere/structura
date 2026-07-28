// PM2 process definitions for the Structura Max backup (owner's Mac).
// Loads secrets from ~/.config/structura-max-secrets at start.
// Usage: pm2 start ecosystem.config.cjs && pm2 save
const fs = require("fs");
const os = require("os");
const secretsFile = os.homedir() + "/.config/structura-max-secrets";
const env = {};
for (const line of fs.readFileSync(secretsFile, "utf8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

module.exports = {
  apps: [
    {
      name: "structura-max",
      script: os.homedir() + "/structura/max-service/server.mjs",
      interpreter: os.homedir() + "/.local/bin/node",
      env: { ...env, PORT: "8791", MAX_MODEL: "haiku" },
      autorestart: true,
      max_restarts: 20,
    },
    {
      name: "structura-max-tunnel",
      script: os.homedir() + "/.local/bin/cloudflared",
      args: "tunnel --config " + os.homedir() + "/.cloudflared/structura-max.yml run",
      autorestart: true,
      max_restarts: 20,
    },
  ],
};
