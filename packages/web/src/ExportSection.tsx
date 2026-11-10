import { useApolloClient, useQuery } from '@apollo/client/react';
import { useState } from 'react';
import { downloadTextFile, exportFileName } from './download.ts';
import { EXPORT_GOODREADS_CSV, SETTINGS_PROFILES, type SettingsProfilesData } from './queries.ts';

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
    <section aria-labelledby="export-heading">
      <h2 id="export-heading">Export books</h2>
      <p>Save a reader’s books as a file that Goodreads can import.</p>
      {error && <p role="alert">Something went wrong: {error.message}</p>}
      {!error && (loading || !data) && <p>Loading…</p>}
      {!error && data && (
        <ul>
          {data.family.profiles.map((profile) => (
            <li key={profile.id}>
              <button type="button" disabled={busyId !== null} onClick={() => void exportFor(profile.id, profile.name)}>
                Download books for {profile.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {message?.kind === 'done' && <p role="status">{message.text}</p>}
      {message?.kind === 'failed' && <p role="alert">{message.text}</p>}
    </section>
  );
}
