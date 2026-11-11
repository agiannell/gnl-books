import { backfillAccountEmail, findFamilyIdForAccount, type BookSource, type Db } from '@gnl-books/core';
import { GraphQLError } from 'graphql';
import type { TokenVerifier } from './auth';
import type { EmailLookup } from './identity';
import type { ParentTokens } from './parentToken';

export interface Context {
  db: Db;
  cognitoSub: string;
  /**
   * The caller's verified email, or null if they have none. Looked up from
   * Cognito on first use and remembered for the rest of the request, so only
   * the few fields that need it pay for the call.
   */
  verifiedEmail: () => Promise<string | null>;
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
  emails: EmailLookup;
  /** Subs whose account email is known to be stored; see the backfill below. Omit to check every time. */
  checkedEmails?: Set<string>;
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

  let email: Promise<string | null> | undefined;
  const verifiedEmail = () => (email ??= args.emails.verifiedEmail(sub));

  // An account made before emails were kept gets its email now, so a new user can name this parent to
  // ask to join. Checked once per sub per `checkedEmails` (the app keeps one per Lambda container), so
  // it is one database read on a container's first request for a user and nothing after. It must never
  // fail the request: if it cannot be stored this time, the next request tries again.
  if (familyId && !args.checkedEmails?.has(sub)) {
    try {
      await backfillAccountEmail(args.db, sub, verifiedEmail);
      args.checkedEmails?.add(sub);
    } catch (error) {
      console.error('Could not store the account email', error);
    }
  }

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
    verifiedEmail,
    familyId,
    isParent: unlock !== null,
    parentUnlockStartedAt: unlock?.startedAt ?? null,
    parentTokens: args.parentTokens,
    books: args.books,
  };
}
