import { randomUUID } from 'node:crypto';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db';
import {
  DEFAULT_TIMEZONE,
  getFamilyTimezone,
  InvalidTimezoneError,
  setFamilyTimezone,
  TIMEZONES,
} from '../src/families';

// Runs against the real cluster; skipped unless DSQL_ENDPOINT is set. See CLAUDE.md for the
// command. Each run makes its own family and removes it.
const endpoint = process.env.DSQL_ENDPOINT;

describe.skipIf(!endpoint)('family time zone (live)', () => {
  let db: Db;
  const familyIds: string[] = [];

  beforeAll(() => {
    db = createDb({ host: endpoint! });
  });

  afterAll(async () => {
    for (const id of familyIds) await db.deleteFrom('families').where('id', '=', id).execute();
    await db.destroy();
  });

  const newFamily = async () => {
    const id = randomUUID();
    familyIds.push(id);
    await db.insertInto('families').values({ id, name: 'Zone test', parent_pin_hash: 'x' }).execute();
    return id;
  };

  it('starts on the default zone, because a new family has not chosen one', async () => {
    expect(await getFamilyTimezone(db, await newFamily())).toBe(DEFAULT_TIMEZONE);
  });

  it('keeps the zone that was set, for that family only', async () => {
    const a = await newFamily();
    const b = await newFamily();
    await setFamilyTimezone(db, a, 'Pacific/Auckland');
    expect(await getFamilyTimezone(db, a)).toBe('Pacific/Auckland');
    expect(await getFamilyTimezone(db, b)).toBe(DEFAULT_TIMEZONE);
  });

  it('can change the zone again, and go back to UTC', async () => {
    const id = await newFamily();
    await setFamilyTimezone(db, id, 'Europe/Paris');
    await setFamilyTimezone(db, id, 'UTC');
    expect(await getFamilyTimezone(db, id)).toBe('UTC');
  });

  it.each(['', 'Mars/Phobos', 'america/chicago', 'EST', 'PST8PDT', '+05', 'UTC+5', ' America/Chicago', "'; drop table families; --"])(
    'refuses %j and leaves the zone as it was',
    async (zone) => {
      const id = await newFamily();
      await setFamilyTimezone(db, id, 'Asia/Tokyo');
      await expect(setFamilyTimezone(db, id, zone)).rejects.toBeInstanceOf(InvalidTimezoneError);
      expect(await getFamilyTimezone(db, id)).toBe('Asia/Tokyo');
    },
  );

  // A zone the runtime lists but the database rejects would break every date stamp for a family
  // that chose it, so every offered zone must work in the exact expression the app stamps dates with.
  it('accepts every zone it offers in the expression that stamps dates', async () => {
    const failures: string[] = [];
    for (let i = 0; i < TIMEZONES.length; i += 25) {
      await Promise.all(
        TIMEZONES.slice(i, i + 25).map(async (zone) => {
          try {
            await sql`select (now() at time zone ${zone})::date`.execute(db);
          } catch {
            failures.push(zone);
          }
        }),
      );
    }
    expect(failures).toEqual([]);
  }, 120_000);

  it('stamps dates in the chosen zone', async () => {
    const id = await newFamily();
    // Kiritimati (UTC+14) and Pago Pago (UTC-11) are always on different calendar days.
    await setFamilyTimezone(db, id, 'Pacific/Kiritimati');
    const zone = await getFamilyTimezone(db, id);
    const { rows } = await sql<{ d: string }>`select (now() at time zone ${zone})::date::text as d`.execute(db);
    const east = rows[0]!.d;
    await setFamilyTimezone(db, id, 'Pacific/Pago_Pago');
    const west = (await sql<{ d: string }>`select (now() at time zone ${await getFamilyTimezone(db, id)})::date::text as d`.execute(db)).rows[0]!.d;
    expect(east).not.toBe(west);
  });
});
