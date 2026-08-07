const express = require('express');
const { mergeSettings } = require('./utils');

function createApp() {
  const app = express();
  app.use(express.json());

  app.get('/', (req, res) => {
    res.json({ service: 'secure-devops-demo', status: 'ok' });
  });

  // Liveness/readiness probe used by Docker HEALTHCHECK and the ZAP/deploy steps.
  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'healthy' });
  });

  app.get('/api/greet', (req, res) => {
    const name = typeof req.query.name === 'string' ? req.query.name : 'world';
    res.json({ message: `Hello, ${name}!` });
  });

  app.post('/api/settings', (req, res) => {
    const defaults = { theme: 'light', notifications: true };
    const merged = mergeSettings(defaults, req.body || {});
    res.json({ settings: merged });
  });

  return app;
}

module.exports = { createApp };
