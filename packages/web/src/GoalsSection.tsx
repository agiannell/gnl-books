import { useQuery } from '@apollo/client/react';
import { type FormEvent, useState } from 'react';
import { type Edit, useEdit } from './useEdit.ts';
import { type GoalSummary, REMOVE_GOAL, SET_GOAL, SETTINGS_GOALS, type SettingsGoalsData } from './queries.ts';

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
      <strong>{name}</strong>:{' '}
      {goal ? `${goal.booksRead} of ${goal.target} ${goal.target === 1 ? 'book' : 'books'} read` : 'no goal'}
      <form onSubmit={(event) => void save(event)}>
        <label>
          Books to read in {year} for {name}{' '}
          <input value={text} inputMode="numeric" onChange={(event) => setText(event.target.value)} />
        </label>{' '}
        <button type="submit" disabled={busy}>
          Set goal for {name}
        </button>{' '}
        {goal && (
          <button type="button" disabled={busy} onClick={() => void remove()}>
            Remove goal for {name}
          </button>
        )}
        {problem && <p role="alert">{problem}</p>}
      </form>
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
    <section aria-labelledby="goals-heading">
      <h2 id="goals-heading">Reading goals</h2>
      <p>
        <button type="button" disabled={year <= MIN_YEAR} onClick={() => setYear(year - 1)}>
          Earlier year
        </button>{' '}
        <strong>{year}</strong>{' '}
        <button type="button" disabled={year >= MAX_YEAR} onClick={() => setYear(year + 1)}>
          Later year
        </button>
      </p>
      {error && <p role="alert">Something went wrong: {error.message}</p>}
      {!error && (loading || !data) && <p>Loading…</p>}
      {!error && data && (
        <ul>
          {data.family.profiles.map((profile) => (
            // Reset the box when the saved goal (or the year) changes.
            <Goal
              key={`${profile.id}-${year}-${profile.goal?.target ?? 'none'}`}
              profileId={profile.id}
              name={profile.name}
              year={year}
              goal={profile.goal}
              edit={edit}
              busy={busy}
            />
          ))}
        </ul>
      )}
      {editError && <p role="alert">Something went wrong: {editError}</p>}
    </section>
  );
}
