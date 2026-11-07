import { startStandaloneServer } from '@apollo/server/standalone';
import { createApp } from './app';

const app = createApp();

// Needs the same env as the Lambda (DSQL_ENDPOINT, USER_POOL_ID,
// USER_POOL_WEB_CLIENT_ID) plus AWS credentials for the DSQL token.
startStandaloneServer(app.server, {
  listen: { port: 4000 },
  context: async ({ req }) => app.context(req.headers.authorization),
}).then(({ url }) => console.log(`GraphQL on ${url}`));
