import { type CompiledQuery, DummyDriver, Kysely, PostgresAdapter, PostgresIntrospector, PostgresQueryCompiler } from 'kysely';
import { describe, expect, it } from 'vitest';
import type { Db } from '../src/db';
import { DEFAULT_TIMEZONE, InvalidTimezoneError, setFamilyTimezone, TIMEZONES } from '../src/families';

// The name is checked before the database is asked, so these need no database: a Db that fails
// the test if it is touched.
const untouched = new Proxy({}, { get: () => () => { throw new Error('the database was asked'); } }) as unknown as Db;

/** A database that records every query and fails any whose text matches `failOn` with the given error. */
function fakeDb(failOn?: { match: RegExp; error: Error }) {
  const queries: CompiledQuery[] = [];
  class Driver extends DummyDriver {
    override async acquireConnection() {
      return {
        executeQuery: async (query: CompiledQuery) => {
          queries.push(query);
          if (failOn?.match.test(query.sql)) throw failOn.error;
          return { rows: [] };
        },
        streamQuery: async function* () {},
      };
    }
  }
  const db = new Kysely<unknown>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new Driver(),
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  }) as unknown as Db;
  return { db, queries };
}

describe('the zones a family can choose', () => {
  it('lists real IANA names, UTC and the default, with no repeats, in order', () => {
    expect(TIMEZONES).toContain('UTC');
    expect(TIMEZONES).toContain(DEFAULT_TIMEZONE);
    expect(TIMEZONES).toContain('Pacific/Kiritimati');
    expect(new Set(TIMEZONES).size).toBe(TIMEZONES.length);
    expect([...TIMEZONES]).toEqual([...TIMEZONES].sort());
    expect(TIMEZONES.length).toBeGreaterThan(300);
  });

  it('holds no loose forms the database would take', () => {
    for (const zone of ['EST', 'PST8PDT', 'GMT+5', '+05']) expect(TIMEZONES).not.toContain(zone);
    expect(TIMEZONES.every((zone) => zone === 'UTC' || zone.includes('/'))).toBe(true);
  });

  it.each(['', 'Mars/Phobos', 'america/chicago', 'EST', ' UTC', 'UTC '])(
    'refuses %j before asking the database',
    async (zone) => {
      await expect(setFamilyTimezone(untouched, 'f-1', zone)).rejects.toBeInstanceOf(InvalidTimezoneError);
    },
  );
});

describe('setFamilyTimezone', () => {
  it('checks the zone with the database, then saves it for that family', async () => {
    const { db, queries } = fakeDb();
    await setFamilyTimezone(db, 'f-1', 'Europe/Paris');
    expect(queries).toHaveLength(2);
    expect(queries[0]!.sql).toMatch(/at time zone/);
    expect(queries[0]!.parameters).toEqual(['Europe/Paris']);
    expect(queries[1]!.sql).toMatch(/update "families" set "timezone" = \$1 where "id" = \$2/);
    expect(queries[1]!.parameters).toEqual(['Europe/Paris', 'f-1']);
  });

  it('saves nothing when the database does not recognise a zone the list allowed', async () => {
    const { db, queries } = fakeDb({ match: /at time zone/, error: Object.assign(new Error('time zone not recognized'), { code: '22023' }) });
    await expect(setFamilyTimezone(db, 'f-1', 'Europe/Paris')).rejects.toBeInstanceOf(InvalidTimezoneError);
    expect(queries.some((q) => /update/.test(q.sql))).toBe(false);
  });

  it('lets any other database failure through as it is, and saves nothing', async () => {
    const boom = Object.assign(new Error('connection lost'), { code: '08006' });
    const { db, queries } = fakeDb({ match: /at time zone/, error: boom });
    await expect(setFamilyTimezone(db, 'f-1', 'Europe/Paris')).rejects.toBe(boom);
    expect(queries.some((q) => /update/.test(q.sql))).toBe(false);
  });

  it('lets a failure of the save itself through', async () => {
    const boom = new Error('conflict');
    const { db } = fakeDb({ match: /update/, error: boom });
    await expect(setFamilyTimezone(db, 'f-1', 'Europe/Paris')).rejects.toBe(boom);
  });
});
