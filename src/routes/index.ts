// auth0Routes() has been removed.
//
// React Router's routes.ts only accepts file-based route configs ({ path, file }).
// Inline route objects with loader/action functions are rejected at build time.
//
// To register the Auth0 auth endpoints, create a splat route in your app:
//
//   app/routes/auth.$.tsx
//   ─────────────────────
//   import { Auth0Server, handleAuth } from '@auth0/auth0-react-router/server';
//
//   const auth0 = new Auth0Server();
//
//   export const loader = ({ request }) => handleAuth(auth0, request);
//   export const action = ({ request }) => handleAuth(auth0, request);
//
//   app/routes.ts
//   ─────────────
//   import { route } from '@react-router/dev/routes';
//   export default [
//     route('auth/*', 'routes/auth.$.tsx'),
//     ...
//   ];
