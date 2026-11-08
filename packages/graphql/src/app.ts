import { ApolloServer } from '@apollo/server';
import { ApolloServerErrorCode } from '@apollo/server/errors';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import { createDb } from '@gnl-books/core';
import { createCognitoVerifier } from './auth';
import { buildContext, type Context } from './context';
import { schema } from './schema';

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function createServer(): ApolloServer<Context> {
  // Apollo serves a landing page to browsers before it checks the token. It
  // exposes no data, but there is no reason for a public URL to show it.
  return new ApolloServer<Context>({
    schema,
    plugins: [ApolloServerPluginLandingPageDisabled()],
    // Apollo includes stack traces unless NODE_ENV is "production", which a
    // Lambda doesn't set. They carry server file paths, so turn them off here
    // rather than depend on an environment variable.
    includeStacktraceInErrorResponses: false,
    // Errors we throw on purpose (GraphQLError with a code) reach the caller as
    // written. Anything else is a bug or an outage, and its message can carry a
    // hostname or a SQL fragment, so the caller gets a generic one and the real
    // error goes to the logs.
    formatError: (formatted, error) => {
      if (formatted.extensions?.code !== ApolloServerErrorCode.INTERNAL_SERVER_ERROR) return formatted;
      console.error(error);
      return { ...formatted, message: 'Internal server error' };
    },
  });
}

// The one place the server is assembled, so the Lambda and the local dev
// server cannot drift apart.
export function createApp(env: NodeJS.ProcessEnv = process.env) {
  const db = createDb({ host: required(env, 'DSQL_ENDPOINT') });
  const verifier = createCognitoVerifier({
    userPoolId: required(env, 'USER_POOL_ID'),
    clientId: [required(env, 'USER_POOL_WEB_CLIENT_ID')],
  });
  const server = createServer();
  return {
    server,
    context: (authorization: string | undefined) => buildContext({ db, verifier, authorization }),
  };
}
