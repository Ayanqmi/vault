module.exports = {
  apps: [{
    name: 'ayanami-vault',
    script: 'dist/server.js',
    cwd: '/opt/ayanami.vault',
    env: {
      NODE_ENV: 'production',
    },
    restart_delay: 3000,
    max_restarts: 10,
  }],
};
