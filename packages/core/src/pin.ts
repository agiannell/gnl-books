import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// The parent PIN gates sensitive actions inside an already signed-in session,
// because a kid using the family tablet has that session. It is a convenience
// gate, not a secret worth defending offline: a 4-8 digit PIN has at most 10^8
// values, so no hash stops someone who has read the database. Hashing keeps the
// PIN out of plain sight in a dump; the real protection is that the API is only
// reachable with a valid Cognito token.

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEY_LENGTH = 32;
// scrypt needs about 128 * N * R bytes; Node's default limit is exactly that.
const MAX_MEMORY = 64 * 1024 * 1024;

export const PIN_PATTERN = /^\d{4,8}$/;

const derive = (pin: string, salt: Buffer, options: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scrypt(pin, salt, KEY_LENGTH, options, (error, key) => (error ? reject(error) : resolve(key))),
  );

/** `scrypt$N$r$p$salt$hash`, with the parameters stored so they can change later. */
export async function hashPin(pin: string): Promise<string> {
  if (!PIN_PATTERN.test(pin)) throw new Error('PIN must be 4 to 8 digits');
  const salt = randomBytes(16);
  const key = await derive(pin, salt, { N, r: R, p: P, maxmem: MAX_MEMORY });
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

/** False for a wrong PIN and for a stored value it cannot parse; never throws on bad input. */
export async function verifyPin(pin: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  try {
    const key = await derive(pin, Buffer.from(salt, 'base64'), {
      N: Number(n),
      r: Number(r),
      p: Number(p),
      maxmem: MAX_MEMORY,
    });
    return key.length === expected.length && timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}
