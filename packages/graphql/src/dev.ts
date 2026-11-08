import { startStandaloneServer } from '@apollo/server/standalone';
import { createApp } from './app';

const app = createApp();

// Needs the same env as the Lambda (DSQL_ENDPOINT, USER_POOL_ID,
// USER_POOL_WEB_CLIENT_ID) plus AWS credentials for the DSQL token. Set
// PARENT_TOKEN_SECRET (32+ characters) instead of PARENT_TOKEN_SECRET_ARN.
startStandaloneServer(app.server, {
  listen: { port: 4000 },
  context: async ({ req }) => {
    const parentToken = req.headers['x-parent-token'];
    return app.context(req.headers.authorization, Array.isArray(parentToken) ? parentToken[0] : parentToken);
  },
}).then(({ url }) => console.log(`GraphQL on ${url}`));
