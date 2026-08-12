import tsParser from '@typescript-eslint/parser';
import security from 'eslint-plugin-security';

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: 'tsconfig.json',
        sourceType: 'module'
      }
    },
    plugins: {
      security
    },
    rules: {
      ...security.configs.recommended.rules
    }
  }
];
