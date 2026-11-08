import { ApolloServer } from '@apollo/server';
import { ApolloServerErrorCode } from '@apollo/server/errors';
import { ApolloServerPluginLandingPageDisabled } from '@apollo/server/plugin/disabled';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createDb } from '@gnl-books/core';
import { createCognitoVerifier } from './auth';
import { buildContext, type Context } from './context';
import { createParentTokens, type ParentTokens } from './parentToken';
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

/**
 * Builds the parent-token signer on first use, not at startup, so requests that
 * carry no unlock token never wait for the secret. A failed load is not cached.
 */
export function lazyParentTokens(loadSecret: () => Promise<string>): ParentTokens {
  let ready: Promise<ParentTokens> | undefined;
  const tokens = () => {
    ready ??= loadSecret()
      .then((secret) => createParentTokens(secret))
      .catch((error) => {
        ready = undefined;
        throw error;
      });
    return ready;
  };
  return {
    issue: async (args) => (await tokens()).issue(args),
    verify: async (token, who) => (await tokens()).verify(token, who),
  };
}

// The key the stack generates inside the gnl-books/cdk secret's JSON.
const PARENT_TOKEN_KEY = 'parentTokenKey';

/** Reads one string out of a JSON secret. Throws if the secret or the key is missing. */
export function jsonSecretValue(secretString: string | undefined, key: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(secretString ?? '');
  } catch {
    throw new Error('The secret is empty or not JSON');
  }
  const value = typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>)[key] : undefined;
  if (typeof value !== 'string' || !value) throw new Error(`The secret has no "${key}" value`);
  return value;
}

// The signing key lives in Secrets Manager. PARENT_TOKEN_SECRET is for local
// development only, where there is no secret to read.
function parentTokenSecret(env: NodeJS.ProcessEnv): () => Promise<string> {
  const local = env.PARENT_TOKEN_SECRET;
  if (local) return async () => local;
  const secretId = required(env, 'CDK_SECRET_ARN');
  return async () => {
    const { SecretString } = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: secretId }));
    return jsonSecretValue(SecretString, PARENT_TOKEN_KEY);
  };
}

// The one place the server is assembled, so the Lambda and the local dev
// server cannot drift apart.
export function createApp(env: NodeJS.ProcessEnv = process.env) {
  const db = createDb({ host: required(env, 'DSQL_ENDPOINT') });
  const parentTokens = lazyParentTokens(parentTokenSecret(env));
  const verifier = createCognitoVerifier({
    userPoolId: required(env, 'USER_POOL_ID'),
    clientId: [required(env, 'USER_POOL_WEB_CLIENT_ID')],
  });
  const server = createServer();
  return {
    server,
    context: (authorization: string | undefined, parentToken?: string | undefined) =>
      buildContext({ db, verifier, parentTokens, authorization, parentToken }),
  };
}
