import { findFamilyIdForAccount, type Db } from '@gnl-books/core';
import { GraphQLError } from 'graphql';
import type { TokenVerifier } from './auth';

export interface Context {
  db: Db;
  cognitoSub: string;
  /** Null until first-run bootstrap creates the caller's family. */
  familyId: string | null;
  /** Always false for now: the parent-PIN unlock that sets it is a later step. */
  isParent: boolean;
}

function unauthenticated(message: string): GraphQLError {
  return new GraphQLError(message, {
    extensions: { code: 'UNAUTHENTICATED', http: { status: 401 } },
  });
}

// Every identity here comes from the verified token and the database, never
// from anything else the client sent.
export async function buildContext(args: {
  db: Db;
  verifier: TokenVerifier;
  authorization: string | undefined;
}): Promise<Context> {
  const token = /^Bearer (\S+)$/i.exec(args.authorization ?? '')?.[1];
  if (!token) throw unauthenticated('Missing bearer token');

  let sub: string;
  try {
    ({ sub } = await args.verifier.verify(token));
  } catch {
    // The verifier's message can describe why a token failed; don't hand that
    // to a caller who is probing.
    throw unauthenticated('Invalid or expired token');
  }

  const familyId = (await findFamilyIdForAccount(args.db, sub)) ?? null;
  return { db: args.db, cognitoSub: sub, familyId, isParent: false };
}
