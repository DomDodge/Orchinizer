// Default Expo config plus dev-only routes on the Metro server (so they work over `--tunnel` too):
// - WebSocket /ws: mock lobby standing in for Bryson's server (scripts/mock-lobby.mts)
// - POST /sensor-log: forwards the Sensor test stream to `npm run sensor-log` on this laptop
const { getDefaultConfig } = require('expo/metro-config');
const http = require('http');

const config = getDefaultConfig(__dirname);
require('./scripts/mock-lobby.mts').attachMockLobby('/ws');

config.server = {
  ...config.server,
  enhanceMiddleware: (middleware) => (req, res, next) => {
    if (req.method !== 'POST' || !req.url.startsWith('/sensor-log')) return middleware(req, res, next);
    const fwd = http.request({ host: '127.0.0.1', port: 8090, method: 'POST', path: '/' }, (r) => {
      r.resume();
      res.end('ok');
    });
    fwd.on('error', () => {
      res.statusCode = 502;
      res.end('npm run sensor-log is not running');
    });
    req.pipe(fwd);
  },
};

module.exports = config;
