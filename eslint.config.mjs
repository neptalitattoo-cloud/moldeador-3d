import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['vendor/**', 'data/**', 'icons/**', 'node_modules/**', 'test-results/**', 'playwright-report/**'] },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      eqeqeq: ['warn', 'smart'],
      'prefer-const': ['warn', { destructuring: 'all' }],
    },
  },
  { files: ['js/**/*.js'], languageOptions: { globals: globals.browser } },
  { files: ['js/fit-worker.js'], languageOptions: { globals: globals.worker } },
  { files: ['sw.js'], languageOptions: { globals: { ...globals.serviceworker, AbortController: 'readonly' } } },
  { files: ['tests/**', 'e2e/**', '*.mjs'], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
];
