import { handlers, startServerAndCreateLambdaHandler } from '@as-integrations/aws-lambda';
import { createApp } from './app';

// Built once per container; the connection pool and JWKS cache live across invocations.
const app = createApp();

export const handler = startServerAndCreateLambdaHandler(
  app.server,
  handlers.createAPIGatewayProxyEventV2RequestHandler(),
  // API Gateway v2 lowercases header names.
  { context: async ({ event }) => app.context(event.headers.authorization) },
);
