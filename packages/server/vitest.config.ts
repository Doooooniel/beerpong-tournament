import { defaultServerConditions } from 'vite';
import { defineProject } from 'vitest/config';

export default defineProject({
  // `source` zeigt auf core/src (siehe exports in packages/core/package.json).
  ssr: { resolve: { conditions: ['source', ...defaultServerConditions] } },
  test: {
    name: 'server',
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
