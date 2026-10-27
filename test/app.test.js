const request = require('supertest');
const { createApp } = require('../src/app');

const app = createApp();

describe('GET /', () => {
  it('returns service status', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /health', () => {
  it('returns healthy', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
  });
});

describe('GET /api/greet', () => {
  it('greets with default name when none provided', async () => {
    const res = await request(app).get('/api/greet');
    expect(res.body.message).toBe('Hello, world!');
  });

  it('greets with the provided name', async () => {
    const res = await request(app).get('/api/greet?name=Tania');
    expect(res.body.message).toBe('Hello, Tania!');
  });
});

describe('POST /api/settings', () => {
  it('merges provided settings on top of defaults', async () => {
    const res = await request(app).post('/api/settings').send({ theme: 'dark' });
    expect(res.status).toBe(200);
    expect(res.body.settings.theme).toBe('dark');
    expect(res.body.settings.notifications).toBe(true);
  });

  it('does not allow prototype pollution through __proto__', async () => {
    await request(app)
      .post('/api/settings')
      .set('Content-Type', 'application/json')
      .send('{"__proto__":{"polluted":"yes"}}');
    expect({}.polluted).toBeUndefined();
  });
});

describe('security headers', () => {
  it('sets the headers the DAST scan expects and hides X-Powered-By', async () => {
    const res = await request(app).get('/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['cross-origin-resource-policy']).toBeDefined();
    expect(res.headers['permissions-policy']).toBeDefined();
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('also sets them on 404 responses', async () => {
    const res = await request(app).get('/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
  });
});
