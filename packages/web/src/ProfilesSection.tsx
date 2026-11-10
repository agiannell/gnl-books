import { useQuery } from '@apollo/client/react';
import { type FormEvent, useState } from 'react';
import { CREATE_PROFILE, DELETE_PROFILE, SETTINGS_PROFILES, type SettingsProfile, type SettingsProfilesData } from './queries.ts';
import { useEdit } from './useEdit.ts';

// Matches the API's limits on a profile.
const MAX_NAME_CHARACTERS = 60;
const MAX_EMOJI_CHARACTERS = 8;

// Colours a reader can pick; the API takes any `#rrggbb`. None means no coloured border.
const COLORS = [
  { value: '', label: 'No colour' },
  { value: '#d64545', label: 'Red' },
  { value: '#e8833a', label: 'Orange' },
  { value: '#d9a520', label: 'Yellow' },
  { value: '#3f9d55', label: 'Green' },
  { value: '#3366cc', label: 'Blue' },
  { value: '#8a5cc2', label: 'Purple' },
  { value: '#d6579a', label: 'Pink' },
];

function AddProfile({ edit, busy }: { edit: ReturnType<typeof useEdit>['edit']; busy: boolean }) {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState('');
  const [color, setColor] = useState('');
  const [isParent, setIsParent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return setProblem('Give the reader a name');
    // Counted in characters, as the API does: one emoji can be several UTF-16 units, so maxLength would be wrong.
    if (Array.from(emoji.trim()).length > MAX_EMOJI_CHARACTERS) {
      return setProblem(`Emoji must be at most ${MAX_EMOJI_CHARACTERS} characters`);
    }
    setProblem(null);
    const added = await edit({
      mutation: CREATE_PROFILE,
      variables: { input: { name: name.trim(), emoji: emoji.trim() || null, color: color || null, isParent } },
      // The "who's reading" screen reads the same `family` data, so this refresh updates it too.
      refetchQueries: [SETTINGS_PROFILES],
    });
    if (added) {
      setName('');
      setEmoji('');
      setColor('');
      setIsParent(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <h3>Add a reader</h3>
      <p>
        <label>
          Name <input value={name} maxLength={MAX_NAME_CHARACTERS} onChange={(e) => setName(e.target.value)} />
        </label>
      </p>
      <p>
        <label>
          Emoji (optional) <input value={emoji} onChange={(e) => setEmoji(e.target.value)} size={4} />
        </label>
      </p>
      <p>
        <label>
          Colour{' '}
          <select value={color} onChange={(e) => setColor(e.target.value)}>
            {COLORS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </p>
      <p>
        <label>
          <input type="checkbox" checked={isParent} onChange={(e) => setIsParent(e.target.checked)} /> This reader is a parent
        </label>
      </p>
      <button type="submit" disabled={busy}>
        Add reader
      </button>
      {problem && <p role="alert">{problem}</p>}
    </form>
  );
}

function Reader({
  profile,
  onlyOne,
  confirming,
  setConfirming,
  edit,
  busy,
}: {
  profile: SettingsProfile;
  onlyOne: boolean;
  confirming: boolean;
  setConfirming: (confirming: boolean) => void;
  edit: ReturnType<typeof useEdit>['edit'];
  busy: boolean;
}) {
  const remove = async () => {
    const gone = await edit({
      mutation: DELETE_PROFILE,
      variables: { profileId: profile.id },
      refetchQueries: [SETTINGS_PROFILES],
    });
    if (gone) setConfirming(false);
  };
  return (
    <li>
      {profile.emoji && <span aria-hidden="true">{profile.emoji} </span>}
      <strong>{profile.name}</strong>
      {profile.isParent && ' (parent)'}{' '}
      {confirming ? (
        <>
          <span>Delete {profile.name} and all their books? This cannot be undone.</span>{' '}
          <button type="button" disabled={busy} onClick={() => void remove()}>
            Yes, delete {profile.name}
          </button>{' '}
          <button type="button" disabled={busy} onClick={() => setConfirming(false)}>
            Keep {profile.name}
          </button>
        </>
      ) : (
        <button type="button" disabled={busy || onlyOne} title={onlyOne ? 'A family needs at least one reader' : undefined} onClick={() => setConfirming(true)}>
          Delete {profile.name}
        </button>
      )}
    </li>
  );
}

/** The family's readers: who is on the tablet, adding one, and removing one with all their books. */
export default function ProfilesSection() {
  const { data, loading, error } = useQuery<SettingsProfilesData>(SETTINGS_PROFILES, { fetchPolicy: 'cache-and-network' });
  const { edit, busy, error: editError } = useEdit();
  // Only one confirmation is open at a time.
  const [confirming, setConfirming] = useState<string | null>(null);

  if (error) return <p role="alert">Something went wrong: {error.message}</p>;
  if (loading && !data) return <p>Loading…</p>;
  if (!data) return <p>Loading…</p>;

  const { profiles } = data.family;
  return (
    <section aria-labelledby="profiles-heading">
      <h2 id="profiles-heading">Readers</h2>
      <ul>
        {profiles.map((profile) => (
          <Reader
            key={profile.id}
            profile={profile}
            onlyOne={profiles.length === 1}
            confirming={confirming === profile.id}
            setConfirming={(open) => setConfirming(open ? profile.id : null)}
            edit={edit}
            busy={busy}
          />
        ))}
      </ul>
      {editError && <p role="alert">Something went wrong: {editError}</p>}
      <AddProfile edit={edit} busy={busy} />
    </section>
  );
}
