import { useQuery } from '@apollo/client/react';
import { Button, Flex, Text } from '@radix-ui/themes';
import { type FormEvent, useState } from 'react';
import { SET_TIMEZONE, SETTINGS_TIMEZONE, type SettingsTimezoneData } from './queries.ts';
import { Alert, Field, Loading, Panel } from './ui.tsx';
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
      <Flex direction="column" gap="3">
        <Text color="gray">
          Dates (when a book was finished, and which year it counts for) are kept in this time zone. Changing it does
          not change dates already saved.
        </Text>
        <Field label="Time zone">
          <select className="native" value={zone} onChange={(event) => setZone(event.target.value)}>
            {options.map((name) => (
              <option key={name} value={name}>
                {label(name)}
              </option>
            ))}
          </select>
        </Field>
        <Flex gap="3" align="center" wrap="wrap">
          <Button type="submit" size="3" disabled={busy || zone === saved}>
            Save time zone
          </Button>
          {device !== zone && ZONES.includes(device) && (
            <Flex align="center" gap="2" wrap="wrap">
              <Text size="2" color="gray">
                This device is set to {label(device)}.
              </Text>
              <Button type="button" variant="soft" disabled={busy} onClick={() => setZone(device)}>
                Use {label(device)}
              </Button>
            </Flex>
          )}
        </Flex>
        {error && <Alert>Something went wrong: {error}</Alert>}
      </Flex>
    </form>
  );
}

/** The family's time zone: which day a finished book lands on. */
export default function TimezoneSection() {
  const { data, loading, error } = useQuery<SettingsTimezoneData>(SETTINGS_TIMEZONE, { fetchPolicy: 'cache-and-network' });
  return (
    <Panel id="timezone-heading" title="Time zone">
      {error && <Alert>Something went wrong: {error.message}</Alert>}
      {!error && (loading || !data) && <Loading />}
      {/* Rebuilt when the saved zone changes, so the picker starts on what is saved. */}
      {!error && data && <Picker key={data.family.timezone} saved={data.family.timezone} />}
    </Panel>
  );
}
