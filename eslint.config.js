import js from '@eslint/js';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

const noDefaultExport = {
  selector: 'ExportDefaultDeclaration',
  message: 'Keine Default-Exports (Ausnahme: React-Seiten *Page.tsx und Tool-Konfigurationen).',
};

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      'node_modules/**',
      'data/**',
      'playwright-report/**',
      'test-results/**',
      'packages/server/drizzle/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-syntax': ['error', noDefaultExport],
    },
  },
  {
    files: ['**/*Page.tsx', '**/*.config.{ts,js}', 'eslint.config.js'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },
  {
    files: ['packages/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^(?!(zod|vitest)$|[.]{1,2}/)',
              message:
                'core darf nur zod importieren (keine Node-APIs, kein React, kein server/web).',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        'process',
        'window',
        'document',
        'fetch',
        'setTimeout',
        'setInterval',
        'crypto',
        'performance',
        'globalThis',
        'require',
        'queueMicrotask',
      ],
      'no-restricted-syntax': [
        'error',
        noDefaultExport,
        {
          selector: "MemberExpression[object.name='Date'][property.name='now']",
          message: 'Kein Date.now() in core – Zeit kommt über ctx.now.',
        },
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'Kein new Date() in core – Zeit kommt über ctx.now.',
        },
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message: 'Kein Math.random() in core – Zufall kommt über ctx.random.',
        },
      ],
    },
  },
  {
    files: ['packages/core/vitest.config.ts'],
    rules: { 'no-restricted-imports': 'off', 'no-restricted-syntax': 'off' },
  },
  {
    files: ['packages/server/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@bierpong/web', 'react', 'react-*'],
              message: 'server darf web/React nicht importieren.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/web/src/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@bierpong/server', 'node:*'],
              message: 'web darf server/Node-APIs nicht importieren.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
