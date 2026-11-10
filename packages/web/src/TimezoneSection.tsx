import { useQuery } from '@apollo/client/react';
import { type FormEvent, useState } from 'react';
import { SET_TIMEZONE, SETTINGS_TIMEZONE, type SettingsTimezoneData } from './queries.ts';
import { useEdit } from './useEdit.ts';

// The browser's zone names, plus UTC (which its list leaves out). The API checks the choice again,
// so a name this browser knows and the server does not is refused with the server's message.
const ZONES = [...new Set([...Intl.supportedValuesOf('timeZone'), 'UTC'])].sort();

/** "America/New_York" as "America/New York": underscores are for machines. */
const label = (zone: string) => zone.replaceAll('_', ' ');

const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

function Picker({ saved }: { saved: string }) {
  const { edit, busy, error } = useEdit();
  const [zone, setZone] = useState(saved);
  const device = deviceZone();
  // The saved zone is always offered, even if this browser's list lacks it.
  const options = ZONES.includes(saved) ? ZONES : [saved, ...ZONES];

  const save = (event: FormEvent) => {
    event.preventDefault();
    void edit({ mutation: SET_TIMEZONE, variables: { timezone: zone }, refetchQueries: [SETTINGS_TIMEZONE] });
  };

  return (
    <form onSubmit={save}>
      <p>
        Dates (when a book was finished, and which year it counts for) are kept in this time zone. Changing it does
        not change dates already saved.
      </p>
      <label>
        Time zone{' '}
        <select value={zone} onChange={(event) => setZone(event.target.value)}>
          {options.map((name) => (
            <option key={name} value={name}>
              {label(name)}
            </option>
          ))}
        </select>
      </label>{' '}
      <button type="submit" disabled={busy || zone === saved}>
        Save time zone
      </button>
      {device !== zone && ZONES.includes(device) && (
        <p>
          This device is set to {label(device)}.{' '}
          <button type="button" disabled={busy} onClick={() => setZone(device)}>
            Use {label(device)}
          </button>
        </p>
      )}
      {error && <p role="alert">Something went wrong: {error}</p>}
    </form>
  );
}

/** The family's time zone: which day a finished book lands on. */
export default function TimezoneSection() {
  const { data, loading, error } = useQuery<SettingsTimezoneData>(SETTINGS_TIMEZONE, { fetchPolicy: 'cache-and-network' });
  return (
    <section aria-labelledby="timezone-heading">
      <h2 id="timezone-heading">Time zone</h2>
      {error && <p role="alert">Something went wrong: {error.message}</p>}
      {!error && (loading || !data) && <p>Loading…</p>}
      {/* Rebuilt when the saved zone changes, so the picker starts on what is saved. */}
      {!error && data && <Picker key={data.family.timezone} saved={data.family.timezone} />}
    </section>
  );
}
