import Fastify, { type FastifyInstance } from 'fastify';

export const buildApp = (): FastifyInstance => {
  const app = Fastify({ logger: false });
  app.get('/api/health', () => ({ status: 'ok' }));
  return app;
};
