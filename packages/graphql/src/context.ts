import { findFamilyIdForAccount, type BookSource, type Db } from '@gnl-books/core';
import { GraphQLError } from 'graphql';
import type { TokenVerifier } from './auth';
import type { ParentTokens } from './parentToken';

export interface Context {
  db: Db;
  cognitoSub: string;
  /** Null until first-run bootstrap creates the caller's family. */
  familyId: string | null;
  /** True only while a valid parent-unlock token for this user and family was sent. */
  isParent: boolean;
  /** When the PIN was entered, so a renewal keeps the original start (and the cap). */
  parentUnlockStartedAt: Date | null;
  parentTokens: ParentTokens;
  /** Where book searches and details come from (Hardcover). */
  books: BookSource;
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
  parentTokens: ParentTokens;
  books: BookSource;
  authorization: string | undefined;
  /** The `X-Parent-Token` header, if any. */
  parentToken?: string | undefined;
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

  // An expired, forged, or someone else's unlock token is not an error: the
  // caller is simply not a parent, and parent-only fields will say FORBIDDEN.
  // The key is only fetched when a token was actually sent.
  const unlock =
    familyId && args.parentToken
      ? await args.parentTokens.verify(args.parentToken, { sub, familyId })
      : null;

  return {
    db: args.db,
    cognitoSub: sub,
    familyId,
    isParent: unlock !== null,
    parentUnlockStartedAt: unlock?.startedAt ?? null,
    parentTokens: args.parentTokens,
    books: args.books,
  };
}
