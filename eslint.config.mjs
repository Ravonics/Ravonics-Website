import tseslint from 'typescript-eslint';
import globals from 'globals';

export default [
  {
    ignores: [
      'build/**',
      'dist/**',
      'node_modules/**',
      'proxy/node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**'
    ]
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{js,mjs,ts}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    rules: {
      'no-constant-condition': 'warn',
      'no-duplicate-imports': 'error',
      'no-undef': 'error',
      'no-unreachable': 'error',
      '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true }]
    }
  }
];
