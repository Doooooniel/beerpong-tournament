import { describe, expect, it } from 'vitest';
import { buildApp } from './app.js';
import { loadConfig } from './config.js';

describe('server', () => {
  it('answers the health check', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    await app.close();
  });

  it('uses defaults from ARCHITECTURE.md', () => {
    expect(loadConfig({})).toEqual({ port: 3000, host: '127.0.0.1', dataDir: './data' });
  });
});
