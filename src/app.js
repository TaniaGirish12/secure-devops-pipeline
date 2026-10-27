const express = require('express');
const helmet = require('helmet');
const { mergeSettings } = require('./utils');

function createApp() {
  const app = express();

  // Security headers (X-Content-Type-Options, CSP, CORP, HSTS, ...) and removal of
  // the X-Powered-By banner. These are the findings the OWASP ZAP baseline flags.
  app.use(helmet());

  // Helmet doesn't set these two: opt out of powerful browser features and make
  // sure API responses (which can carry user data) are never cached by proxies.
  app.use((req, res, next) => {
    res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    res.set('Cache-Control', 'no-store');
    next();
  });

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

  // Without this, Express's default 404 page sends its own minimal CSP that overrides
  // Helmet's and omits frame-ancestors/form-action.
  app.use((req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  return app;
}

module.exports = { createApp };
