import { useQuery } from '@apollo/client/react';
import { PersonIcon } from '@radix-ui/react-icons';
import { Badge, Button, Flex, Heading, Separator, Strong, Text, TextField } from '@radix-ui/themes';
import { type CSSProperties, type FormEvent, useState } from 'react';
import { CREATE_PROFILE, DELETE_PROFILE, SETTINGS_PROFILES, type SettingsProfile, type SettingsProfilesData } from './queries.ts';
import { Alert, Field, Loading, Panel } from './ui.tsx';
import { type Edit, useEdit } from './useEdit.ts';

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

function AddProfile({ edit, busy }: { edit: Edit; busy: boolean }) {
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
      <Flex direction="column" gap="3">
        <Heading as="h3" size="3">
          Add a reader
        </Heading>
        <Field label="Name">
          <TextField.Root size="3" value={name} maxLength={MAX_NAME_CHARACTERS} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Emoji (optional)">
          <TextField.Root size="3" value={emoji} onChange={(e) => setEmoji(e.target.value)} style={{ maxWidth: '8rem' }} />
        </Field>
        <Field label="Colour">
          <select className="native" value={color} onChange={(e) => setColor(e.target.value)}>
            {COLORS.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </Field>
        <Text as="label" size="3">
          <Flex align="center" gap="2">
            <input type="checkbox" checked={isParent} onChange={(e) => setIsParent(e.target.checked)} />
            This reader is a parent
          </Flex>
        </Text>
        <Flex>
          <Button type="submit" size="3" disabled={busy}>
            Add reader
          </Button>
        </Flex>
        {problem && <Alert>{problem}</Alert>}
      </Flex>
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
  edit: Edit;
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
      <Flex direction="column" gap="2">
        <Flex align="center" gap="3" wrap="wrap">
          <span
            className="reader-avatar reader-avatar-sm"
            aria-hidden="true"
            // The API only accepts `#rrggbb` for a colour, so it is safe to put in a style.
            style={profile.color ? ({ '--reader-color': profile.color } as CSSProperties) : undefined}
          >
            {profile.emoji ?? <PersonIcon />}
          </span>
          <Text size="4">
            <Strong>{profile.name}</Strong>
          </Text>
          {profile.isParent && (
            <Badge color="orange" variant="soft">
              Parent
            </Badge>
          )}
          {!confirming && (
            <Button
              type="button"
              color="red"
              variant="soft"
              disabled={busy || onlyOne}
              title={onlyOne ? 'A family needs at least one reader' : undefined}
              onClick={() => setConfirming(true)}
              style={{ marginLeft: 'auto' }}
            >
              Delete {profile.name}
            </Button>
          )}
        </Flex>
        {confirming && (
          <Flex align="center" gap="3" wrap="wrap">
            <Text color="red">Delete {profile.name} and all their books? This cannot be undone.</Text>
            <Button type="button" color="red" disabled={busy} onClick={() => void remove()}>
              Yes, delete {profile.name}
            </Button>
            <Button type="button" variant="soft" color="gray" disabled={busy} onClick={() => setConfirming(false)}>
              Keep {profile.name}
            </Button>
          </Flex>
        )}
      </Flex>
    </li>
  );
}

/** The family's readers: who is on the tablet, adding one, and removing one with all their books. */
export default function ProfilesSection() {
  const { data, loading, error } = useQuery<SettingsProfilesData>(SETTINGS_PROFILES, { fetchPolicy: 'cache-and-network' });
  const { edit, busy, error: editError } = useEdit();
  // Only one confirmation is open at a time.
  const [confirming, setConfirming] = useState<string | null>(null);

  if (error) return <Alert>Something went wrong: {error.message}</Alert>;
  if (loading && !data) return <Loading />;
  if (!data) return <Loading />;

  const { profiles } = data.family;
  return (
    <Panel id="profiles-heading" title="Readers">
      <ul className="card-list">
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
      {editError && <Alert>Something went wrong: {editError}</Alert>}
      <Separator size="4" />
      <AddProfile edit={edit} busy={busy} />
    </Panel>
  );
}
