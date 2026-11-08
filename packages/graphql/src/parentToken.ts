import { jwtVerify, SignJWT } from 'jose';

// A signed-in kid holds the same Cognito session as a parent, and the API is
// stateless, so a PIN check has to leave something behind that later requests
// can show. This is it: a short-lived token proving that someone entered the
// parent PIN for this user and family.
//
// It slides: each parent action renews it for another IDLE_TTL, so after the
// last action the window is at most that long. MAX_LIFETIME stops a token that
// keeps being renewed from living forever. It cannot be revoked server-side;
// the SPA discards it when idle, hidden, or locked.

export const IDLE_TTL_SECONDS = 2 * 60;
export const MAX_LIFETIME_SECONDS = 15 * 60;

const ISSUER = 'gnl-books';
// Keeps a token minted for another purpose from being accepted as an unlock,
// should the same key ever sign something else.
const AUDIENCE = 'parent-unlock';

export interface ParentTokens {
  /** `startedAt` is when the PIN was entered; omit it for a fresh unlock, pass it to renew. */
  issue(args: { sub: string; familyId: string; startedAt?: Date }): Promise<{ token: string; expiresAt: Date }>;
  /** The unlock's start time, or null for anything that is not a valid, unexpired token for this user and family. */
  verify(token: string, who: { sub: string; familyId: string }): Promise<{ startedAt: Date } | null>;
}

export function createParentTokens(secret: string, now: () => Date = () => new Date()): ParentTokens {
  if (Buffer.byteLength(secret) < 32) throw new Error('The parent-token secret must be at least 32 bytes');
  const key = new TextEncoder().encode(secret);

  return {
    async issue({ sub, familyId, startedAt }) {
      const at = Math.floor(now().getTime() / 1000);
      const start = startedAt ? Math.floor(startedAt.getTime() / 1000) : at;
      const expires = Math.min(at + IDLE_TTL_SECONDS, start + MAX_LIFETIME_SECONDS);
      if (expires <= at) throw new Error('The parent unlock has reached its maximum lifetime');

      const token = await new SignJWT({ fam: familyId, st: start })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setSubject(sub)
        .setIssuedAt(at)
        .setExpirationTime(expires)
        .sign(key);
      return { token, expiresAt: new Date(expires * 1000) };
    },

    async verify(token, who) {
      try {
        const { payload } = await jwtVerify(token, key, {
          algorithms: ['HS256'],
          issuer: ISSUER,
          audience: AUDIENCE,
          subject: who.sub,
          currentDate: now(),
          requiredClaims: ['exp', 'fam', 'st'],
        });
        if (payload.fam !== who.familyId || typeof payload.st !== 'number') return null;
        // Redundant with `exp`, which never exceeds this, but cheap to keep honest.
        if (now().getTime() / 1000 >= payload.st + MAX_LIFETIME_SECONDS) return null;
        return { startedAt: new Date(payload.st * 1000) };
      } catch {
        // Expired, forged, wrong user, malformed: all the same to the caller.
        return null;
      }
    },
  };
}
