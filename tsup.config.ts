import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/client/index.ts',
    'server/index': 'src/server/index.ts',
    'routes/index': 'src/routes/index.ts',
    'errors/index': 'src/errors/index.ts',
    'types/index': 'src/types/index.ts',
    'testing/index': 'src/testing/index.ts'
  },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  external: [
    '@auth0/auth0-api-js',
    '@auth0/auth0-server-js',
    '@auth0/auth0-spa-js',
    'cookie',
    'react',
    'react-dom',
    'react-router'
  ]
});
