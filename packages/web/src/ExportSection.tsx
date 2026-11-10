import { useApolloClient, useQuery } from '@apollo/client/react';
import { DownloadIcon } from '@radix-ui/react-icons';
import { Button, Text } from '@radix-ui/themes';
import { useState } from 'react';
import { downloadTextFile, exportFileName } from './download.ts';
import { EXPORT_GOODREADS_CSV, SETTINGS_PROFILES, type SettingsProfilesData } from './queries.ts';
import { Alert, Loading, Panel, Status } from './ui.tsx';

/** A reader's whole shelf as a file Goodreads can import: for a child who grows up and gets their own account. */
export default function ExportSection() {
  const client = useApolloClient();
  const { data, loading, error } = useQuery<SettingsProfilesData>(SETTINGS_PROFILES, { fetchPolicy: 'cache-and-network' });
  // The reader being exported, so only that one waits and the others stay ready.
  const [busyId, setBusyId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: 'done' | 'failed'; text: string } | null>(null);

  async function exportFor(id: string, name: string) {
    // Every button is disabled while one export runs, so this is never called twice at once.
    setBusyId(id);
    setMessage(null);
    try {
      const result = await client.mutate<{ exportGoodreadsCsv: string }>({
        mutation: EXPORT_GOODREADS_CSV,
        variables: { profileId: id },
      });
      const csv = result.data?.exportGoodreadsCsv;
      if (csv === undefined) throw new Error('The API sent no file');
      const fileName = exportFileName(name);
      downloadTextFile(fileName, csv);
      setMessage({ kind: 'done', text: `Downloading ${fileName}` });
    } catch (e) {
      setMessage({ kind: 'failed', text: `Something went wrong: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Panel id="export-heading" title="Export books">
      <Text color="gray">Save a reader’s books as a file that Goodreads can import.</Text>
      {error && <Alert>Something went wrong: {error.message}</Alert>}
      {!error && (loading || !data) && <Loading />}
      {!error && data && (
        <ul className="card-list">
          {data.family.profiles.map((profile) => (
            <li key={profile.id}>
              <Button
                type="button"
                variant="soft"
                size="3"
                disabled={busyId !== null}
                onClick={() => void exportFor(profile.id, profile.name)}
              >
                <DownloadIcon aria-hidden="true" />
                Download books for {profile.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {message?.kind === 'done' && <Status>{message.text}</Status>}
      {message?.kind === 'failed' && <Alert>{message.text}</Alert>}
    </Panel>
  );
}
