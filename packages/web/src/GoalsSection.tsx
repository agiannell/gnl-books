import { useQuery } from '@apollo/client/react';
import { Button, Flex, Separator, Strong, Text, TextField } from '@radix-ui/themes';
import { type FormEvent, useState } from 'react';
import { type GoalSummary, REMOVE_GOAL, SET_GOAL, SETTINGS_GOALS, type SettingsGoalsData } from './queries.ts';
import { Alert, Field, Loading, Panel } from './ui.tsx';
import { type Edit, useEdit } from './useEdit.ts';

// The API's limits on a goal (packages/core/src/goals.ts).
const MIN_YEAR = 2000;
const MAX_YEAR = 2100;
const MAX_TARGET = 1000;

function Goal({ profileId, name, year, goal, edit, busy }: {
  profileId: string;
  name: string;
  year: number;
  goal: GoalSummary | null;
  edit: Edit;
  busy: boolean;
}) {
  const [text, setText] = useState(goal ? String(goal.target) : '');
  const [problem, setProblem] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const target = text.trim();
    if (!/^\d+$/.test(target) || Number(target) < 1 || Number(target) > MAX_TARGET) {
      return setProblem(`The goal must be a whole number from 1 to ${MAX_TARGET}`);
    }
    setProblem(null);
    await edit({
      mutation: SET_GOAL,
      variables: { profileId, year, target: Number(target) },
      refetchQueries: [SETTINGS_GOALS],
    });
  }

  // The box empties by itself: once the goal is gone this row is rebuilt (see the key below).
  const remove = () => edit({ mutation: REMOVE_GOAL, variables: { profileId, year }, refetchQueries: [SETTINGS_GOALS] });

  return (
    <li>
      <Flex direction="column" gap="2">
        <Text as="div" size="4">
          <Strong>{name}</Strong>:{' '}
          {goal ? `${goal.booksRead} of ${goal.target} ${goal.target === 1 ? 'book' : 'books'} read` : 'no goal'}
        </Text>
        <form onSubmit={(event) => void save(event)}>
          <Flex gap="3" align="end" wrap="wrap">
            <div style={{ flex: '1 1 10rem' }}>
              <Field label={`Books to read in ${year} for ${name}`}>
                <TextField.Root size="3" value={text} inputMode="numeric" onChange={(event) => setText(event.target.value)} />
              </Field>
            </div>
            <Button type="submit" size="3" disabled={busy}>
              Set goal for {name}
            </Button>
            {goal && (
              <Button type="button" size="3" variant="soft" color="gray" disabled={busy} onClick={() => void remove()}>
                Remove goal for {name}
              </Button>
            )}
          </Flex>
          {problem && (
            <div style={{ marginTop: 'var(--space-2)' }}>
              <Alert>{problem}</Alert>
            </div>
          )}
        </form>
      </Flex>
    </li>
  );
}

/** Each reader's reading goal for one year at a time: set it, change it, or take it away. */
export default function GoalsSection() {
  // The browser's year to start with; the arrows reach any year the API accepts.
  const [year, setYear] = useState(() => new Date().getFullYear());
  const { data, loading, error } = useQuery<SettingsGoalsData>(SETTINGS_GOALS, {
    variables: { year },
    fetchPolicy: 'cache-and-network',
  });
  const { edit, busy, error: editError } = useEdit();

  return (
    <Panel id="goals-heading" title="Reading goals">
      <Flex align="center" gap="3" wrap="wrap">
        <Button type="button" variant="soft" disabled={year <= MIN_YEAR} onClick={() => setYear(year - 1)}>
          Earlier year
        </Button>
        <Text size="5">
          <Strong>{year}</Strong>
        </Text>
        <Button type="button" variant="soft" disabled={year >= MAX_YEAR} onClick={() => setYear(year + 1)}>
          Later year
        </Button>
      </Flex>
      {error && <Alert>Something went wrong: {error.message}</Alert>}
      {!error && (loading || !data) && <Loading />}
      {!error && data && (
        <ul className="card-list">
          {data.family.profiles.flatMap((profile, index) => [
            index > 0 ? <Separator key={`sep-${profile.id}`} size="4" /> : null,
            // Reset the box when the saved goal (or the year) changes.
            <Goal
              key={`${profile.id}-${year}-${profile.goal?.target ?? 'none'}`}
              profileId={profile.id}
              name={profile.name}
              year={year}
              goal={profile.goal}
              edit={edit}
              busy={busy}
            />,
          ])}
        </ul>
      )}
      {editError && <Alert>Something went wrong: {editError}</Alert>}
    </Panel>
  );
}
