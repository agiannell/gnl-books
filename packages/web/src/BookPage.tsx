import { useQuery } from '@apollo/client/react';
import { Button, Card, Flex, Grid, Heading, Strong, Text, TextArea, TextField } from '@radix-ui/themes';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import Cover from './Cover.tsx';
import { formatDate, seriesLabel } from './format.ts';
import NotFound from './NotFound.tsx';
import {
  ADD_TO_SHELF,
  BOOK_PAGE,
  type BookPageData,
  type BookPageEntry,
  FINISH_BOOK,
  LOG_PROGRESS,
  RATE_BOOK,
  REVIEW_BOOK,
  type ShelfName,
} from './queries.ts';
import { Alert, Field, Loading, Panel } from './ui.tsx';
import { type Edit, useEdit } from './useEdit.ts';

const SHELF_LABELS: Record<ShelfName, string> = {
  TO_READ: 'Want to read',
  CURRENTLY_READING: 'Reading now',
  READ: 'Read',
};

// Matches the API's limit on a review.
const MAX_REVIEW_CHARACTERS = 5000;

function Rating({ entry, edit, busy }: { entry: BookPageEntry; edit: Edit; busy: boolean }) {
  const rate = (rating: number | null) =>
    edit({ mutation: RATE_BOOK, variables: { shelfEntryId: entry.id, rating } });
  return (
    <Panel id="rating-heading" title="Rating">
      <Flex gap="1" align="center" wrap="wrap">
        {[1, 2, 3, 4, 5].map((n) => (
          <Button
            key={n}
            type="button"
            variant="ghost"
            color="amber"
            className="star-button"
            aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
            aria-pressed={entry.rating === n}
            disabled={busy}
            onClick={() => void rate(n)}
          >
            {n <= (entry.rating ?? 0) ? '★' : '☆'}
          </Button>
        ))}
        {entry.rating !== null && (
          <Button type="button" variant="soft" color="gray" disabled={busy} onClick={() => void rate(null)}>
            Clear rating
          </Button>
        )}
      </Flex>
      {/* The buttons above are the picture; this is the same thing in words. */}
      {entry.rating !== null && (
        <Text as="p" size="3" color="gray">
          {entry.rating} out of 5 stars
        </Text>
      )}
    </Panel>
  );
}

function Review({ entry, edit, busy }: { entry: BookPageEntry; edit: Edit; busy: boolean }) {
  const saved = entry.review ?? '';
  const [text, setText] = useState(saved);
  const changed = text.trim() !== saved;
  return (
    <Panel id="review-heading" title="Review">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void edit({ mutation: REVIEW_BOOK, variables: { shelfEntryId: entry.id, review: text.trim() } });
        }}
      >
        <Flex direction="column" gap="3" align="start">
          <div style={{ width: '100%' }}>
            <Field label="What did you think?">
              <TextArea
                size="3"
                rows={5}
                value={text}
                maxLength={MAX_REVIEW_CHARACTERS}
                onChange={(event) => setText(event.target.value)}
              />
            </Field>
          </div>
          <Button type="submit" disabled={busy || !changed}>
            Save review
          </Button>
        </Flex>
      </form>
    </Panel>
  );
}

function Progress({ entry, edit, busy }: { entry: BookPageEntry; edit: Edit; busy: boolean }) {
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    const page = text.trim();
    if (!/^\d+$/.test(page)) return setProblem('The page must be a whole number');
    setProblem(null);
    if (await edit({ mutation: LOG_PROGRESS, variables: { shelfEntryId: entry.id, page: Number(page) } })) setText('');
  }

  const { currentPage } = entry;
  return (
    <Panel id="progress-heading" title="Progress">
      {currentPage !== null && (
        <>
          <Text as="p" size="3">
            {entry.book.pages ? `Page ${currentPage} of ${entry.book.pages}` : `Page ${currentPage}`}
          </Text>
          {/* The words above say it; the bar is only for the eye. */}
          {entry.book.pages ? (
            <progress aria-hidden="true" value={Math.min(currentPage, entry.book.pages)} max={entry.book.pages} />
          ) : null}
        </>
      )}
      <form onSubmit={(event) => void save(event)}>
        <Flex gap="3" align="end" wrap="wrap">
          <div style={{ flex: '1 1 10rem' }}>
            <Field label="I’m on page">
              <TextField.Root size="3" value={text} inputMode="numeric" onChange={(event) => setText(event.target.value)} />
            </Field>
          </div>
          <Button type="submit" size="3" disabled={busy}>
            Save page
          </Button>
        </Flex>
      </form>
      {problem && <Alert>{problem}</Alert>}
    </Panel>
  );
}

function Finish({ entry, edit, busy }: { entry: BookPageEntry; edit: Edit; busy: boolean }) {
  const [date, setDate] = useState('');
  return (
    <Panel id="finish-heading" title="Finished?">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          // No date means today, in the family's time zone: the API works that out.
          void edit({ mutation: FINISH_BOOK, variables: { shelfEntryId: entry.id, dateRead: date || null } });
        }}
      >
        <Flex gap="3" align="end" wrap="wrap">
          <div style={{ flex: '1 1 10rem' }}>
            <Field label="Date finished (optional)">
              <TextField.Root size="3" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
          </div>
          <Button type="submit" size="3" disabled={busy}>
            I finished it
          </Button>
        </Flex>
      </form>
    </Panel>
  );
}

/** A reader's copy of one book: where it is on their shelves, and everything they can change about it. */
export default function BookPage() {
  const { profileId = '', bookId = '' } = useParams();
  // Always ask again, so a change made elsewhere (or by someone else in the family) shows.
  const { data, loading, error } = useQuery<BookPageData>(BOOK_PAGE, {
    variables: { id: profileId },
    fetchPolicy: 'cache-and-network',
  });
  const { edit, busy, error: editError } = useEdit();

  if (error) return <Alert>Something went wrong: {error.message}</Alert>;
  if (loading || !data) return <Loading />;
  if (!data.profile) return <NotFound />;

  const entry = data.profile.shelf.find((e) => e.book.id === bookId);
  if (!entry) {
    return (
      <Card size="4" className="centered-card">
        <Flex direction="column" gap="3" align="start">
          <Heading as="h1" size="6">
            Book not found
          </Heading>
          <Text color="gray">This book is not on {data.profile.name}’s shelves.</Text>
          <Button asChild variant="soft" size="3">
            <Link to={`/p/${profileId}`}>Back to the shelves</Link>
          </Button>
        </Flex>
      </Card>
    );
  }

  const { book } = entry;
  const seriesText = seriesLabel(book);
  const move = (shelf: ShelfName) =>
    edit({ mutation: ADD_TO_SHELF, variables: { profileId, bookId: book.id, shelf } });

  return (
    <Flex direction="column" gap="5">
      <div className="book-row">
        <Cover url={book.coverUrl} size="lg" />
        <div className="book-body">
          <Flex direction="column" gap="2">
            <Heading as="h1" size={{ initial: '6', sm: '8' }}>
              {book.title}
            </Heading>
            <Text as="p" size="4" color="gray">
              by {book.authors.join(', ')}
            </Text>
            {seriesText && (
              <Text as="p" size="3" color="gray">
                {seriesText}
              </Text>
            )}
            {(book.releaseYear || book.pages) && (
              <Text as="p" size="3" color="gray">
                {[book.releaseYear, book.pages && `${book.pages} pages`].filter(Boolean).join(' · ')}
              </Text>
            )}
            <Text as="p" size="3">
              On {data.profile.name}’s shelf: <Strong>{SHELF_LABELS[entry.shelf]}</Strong>
              {entry.shelf === 'READ' && entry.dateRead && <> · Finished {formatDate(entry.dateRead)}</>}
            </Text>
          </Flex>
        </div>
      </div>
      {book.description && (
        <Text as="p" size="3">
          {book.description}
        </Text>
      )}
      {editError && <Alert>Something went wrong: {editError}</Alert>}

      <Grid columns={{ initial: '1', md: '2' }} gap="4">
        {entry.shelf !== 'READ' && <Progress key={`progress-${entry.id}`} entry={entry} edit={edit} busy={busy} />}
        {entry.shelf !== 'READ' && <Finish key={`finish-${entry.id}`} entry={entry} edit={edit} busy={busy} />}
        <Rating entry={entry} edit={edit} busy={busy} />
        <Review key={`review-${entry.id}-${entry.review ?? ''}`} entry={entry} edit={edit} busy={busy} />
        <Panel id="move-heading" title="Move to">
          <Flex gap="2" wrap="wrap">
            {(Object.keys(SHELF_LABELS) as ShelfName[])
              .filter((shelf) => shelf !== entry.shelf)
              .map((shelf) => (
                <Button key={shelf} type="button" variant="soft" disabled={busy} onClick={() => void move(shelf)}>
                  {SHELF_LABELS[shelf]}
                </Button>
              ))}
          </Flex>
        </Panel>
      </Grid>

      <Flex>
        <Button asChild variant="ghost" color="gray">
          <Link to={`/p/${profileId}`}>Back to the shelves</Link>
        </Button>
      </Flex>
    </Flex>
  );
}
