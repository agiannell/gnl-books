import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createParentTokens, IDLE_TTL_SECONDS, MAX_LIFETIME_SECONDS } from '../src/parentToken';

const SECRET = 'a'.repeat(48);
const OTHER_SECRET = 'b'.repeat(48);
const who = { sub: 'sub-1', familyId: 'family-1' };
const T0 = new Date('2026-11-08T12:00:00Z');
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

/** Tokens whose clock the test controls. */
function clocked(secret = SECRET) {
  let current = T0;
  return { tokens: createParentTokens(secret, () => current), set: (seconds: number) => (current = at(seconds)) };
}

describe('issue and verify', () => {
  it('accepts a fresh token for the same user and family', async () => {
    const { tokens } = clocked();
    const { token, expiresAt } = await tokens.issue(who);
    expect(expiresAt).toEqual(at(IDLE_TTL_SECONDS));
    expect(await tokens.verify(token, who)).toEqual({ startedAt: T0 });
  });

  it('is not valid for a different user, even in the same family', async () => {
    const { tokens } = clocked();
    const { token } = await tokens.issue(who);
    expect(await tokens.verify(token, { ...who, sub: 'sub-2' })).toBeNull();
  });

  it('is not valid for a different family', async () => {
    const { tokens } = clocked();
    const { token } = await tokens.issue(who);
    expect(await tokens.verify(token, { ...who, familyId: 'family-2' })).toBeNull();
  });
});

describe('lifetime', () => {
  it('lasts the idle window and not a second longer', async () => {
    const { tokens, set } = clocked();
    const { token } = await tokens.issue(who);
    set(IDLE_TTL_SECONDS - 1);
    expect(await tokens.verify(token, who)).not.toBeNull();
    set(IDLE_TTL_SECONDS + 1);
    expect(await tokens.verify(token, who)).toBeNull();
  });

  it('slides: renewing extends it, keeping the original start time', async () => {
    const { tokens, set } = clocked();
    const first = await tokens.issue(who);
    set(100);
    const verified = await tokens.verify(first.token, who);
    const renewed = await tokens.issue({ ...who, startedAt: verified!.startedAt });
    expect(renewed.expiresAt).toEqual(at(100 + IDLE_TTL_SECONDS));

    set(100 + IDLE_TTL_SECONDS - 1); // past the first token's expiry, inside the renewed one's
    expect(await tokens.verify(first.token, who)).toBeNull();
    expect(await tokens.verify(renewed.token, who)).toEqual({ startedAt: T0 });
  });

  it('never extends past the absolute cap, however often it is renewed', async () => {
    const { tokens, set } = clocked();
    let { token, expiresAt } = await tokens.issue(who);
    // Renew every 90 s, well inside the idle window, for as long as it lets us.
    for (let t = 90; t < MAX_LIFETIME_SECONDS; t += 90) {
      set(t);
      const verified = await tokens.verify(token, who);
      expect(verified).not.toBeNull();
      ({ token, expiresAt } = await tokens.issue({ ...who, startedAt: verified!.startedAt }));
    }
    expect(expiresAt.getTime()).toBeLessThanOrEqual(at(MAX_LIFETIME_SECONDS).getTime());
    set(MAX_LIFETIME_SECONDS + 1);
    expect(await tokens.verify(token, who)).toBeNull();
  });

  it('refuses to renew an unlock that has hit the cap', async () => {
    const { tokens, set } = clocked();
    set(MAX_LIFETIME_SECONDS + 5);
    await expect(tokens.issue({ ...who, startedAt: T0 })).rejects.toThrow(/maximum lifetime/);
  });

  it('shortens the last renewal to fit the cap', async () => {
    const { tokens, set } = clocked();
    set(MAX_LIFETIME_SECONDS - 30);
    const { expiresAt } = await tokens.issue({ ...who, startedAt: T0 });
    expect(expiresAt).toEqual(at(MAX_LIFETIME_SECONDS));
  });
});

describe('forgery and misuse', () => {
  it('rejects a token signed with a different key', async () => {
    const { tokens } = clocked();
    const { tokens: attacker } = clocked(OTHER_SECRET);
    const { token } = await attacker.issue(who);
    expect(await tokens.verify(token, who)).toBeNull();
  });

  it('rejects a tampered payload', async () => {
    const { tokens } = clocked();
    const { token } = await tokens.issue(who);
    const [header, , signature] = token.split('.');
    const forged = Buffer.from(
      JSON.stringify({ iss: 'gnl-books', aud: 'parent-unlock', sub: 'sub-1', fam: 'family-1', st: 0, exp: 9999999999 }),
    ).toString('base64url');
    expect(await tokens.verify(`${header}.${forged}.${signature}`, who)).toBeNull();
  });

  it('rejects an unsigned token (alg none)', async () => {
    const { tokens } = clocked();
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'none' })}.${b64({ iss: 'gnl-books', aud: 'parent-unlock', sub: 'sub-1', fam: 'family-1', st: 1, exp: 9999999999 })}.`;
    expect(await tokens.verify(unsigned, who)).toBeNull();
  });

  it('rejects a correctly signed token meant for something else', async () => {
    const { tokens } = clocked();
    const key = new TextEncoder().encode(SECRET);
    const sign = (claims: object, aud: string) =>
      new SignJWT({ fam: 'family-1', st: Math.floor(T0.getTime() / 1000), ...claims })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer('gnl-books')
        .setAudience(aud)
        .setSubject('sub-1')
        .setExpirationTime(Math.floor(T0.getTime() / 1000) + 60)
        .sign(key);
    expect(await tokens.verify(await sign({}, 'something-else'), who)).toBeNull();
    expect(await tokens.verify(await sign({}, 'parent-unlock'), who)).not.toBeNull(); // control
  });

  it.each(['', 'not-a-token', 'a.b.c', 'Bearer x'])('treats %j as not unlocked, without throwing', async (token) => {
    const { tokens } = clocked();
    expect(await tokens.verify(token, who)).toBeNull();
  });

  it('will not start with a short secret', () => {
    expect(() => createParentTokens('short')).toThrow(/at least 32 bytes/);
  });
});
