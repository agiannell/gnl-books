import { useApolloClient } from '@apollo/client/react';
import { MagnifyingGlassIcon } from '@radix-ui/react-icons';
import { Button, Card, Flex, Heading, Strong, Text, TextField } from '@radix-ui/themes';
import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router';
import Cover from './Cover.tsx';
import { seriesLabel } from './format.ts';
import {
  ADD_TO_SHELF,
  IMPORT_BOOK,
  SEARCH_BOOKS,
  type SearchHit,
  type ShelfName,
} from './queries.ts';
import { Alert, Field, Loading, Status, TextLink } from './ui.tsx';

// Matches the API's limit on a search.
const MAX_QUERY_LENGTH = 200;

const SHELF_BUTTONS: { shelf: ShelfName; label: string; done: string }[] = [
  { shelf: 'TO_READ', label: 'Want to read', done: 'Added to Want to read' },
  { shelf: 'CURRENTLY_READING', label: 'Reading now', done: 'Added to Reading now' },
  { shelf: 'READ', label: 'Already read', done: 'Added to Read' },
];

/** What happened the last time a button on this hit was pressed. */
type Outcome = { kind: 'adding' } | { kind: 'added'; text: string } | { kind: 'failed'; message: string };

function Hit({ hit, profileId }: { hit: SearchHit; profileId: string }) {
  const client = useApolloClient();
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const seriesText = seriesLabel(hit);

  async function add(shelf: ShelfName, done: string) {
    if (!hit.sourceId) return;
    setOutcome({ kind: 'adding' });
    try {
      // Importing the same book twice returns the same id, so retrying is safe.
      const imported = await client.mutate<{ importBook: { id: string } }>({
        mutation: IMPORT_BOOK,
        variables: { sourceId: hit.sourceId },
      });
      const bookId = imported.data?.importBook.id;
      if (!bookId) throw new Error('The book could not be saved');
      await client.mutate({
        mutation: ADD_TO_SHELF,
        variables: { profileId, bookId, shelf },
      });
      setOutcome({ kind: 'added', text: done });
    } catch (error) {
      setOutcome({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }

  return (
    <li>
      <Card size="2">
        <div className="book-row">
          <Cover url={hit.coverUrl} />
          <div className="book-body">
            <Flex direction="column" gap="1">
              <Text as="div" size="4">
                <Strong>{hit.title}</Strong>
              </Text>
              <Text as="div" size="2" color="gray">
                by {hit.authors.join(', ')}
              </Text>
              {seriesText && (
                <Text as="div" size="2" color="gray">
                  {seriesText}
                </Text>
              )}
              {(hit.releaseYear || hit.pages) && (
                <Text as="div" size="2" color="gray">
                  {[hit.releaseYear, hit.pages && `${hit.pages} pages`].filter(Boolean).join(' · ')}
                </Text>
              )}
              <Flex gap="2" wrap="wrap" mt="2">
                {SHELF_BUTTONS.map(({ shelf, label, done }) => (
                  <Button
                    key={shelf}
                    type="button"
                    size="2"
                    variant="soft"
                    disabled={!hit.sourceId || outcome?.kind === 'adding'}
                    onClick={() => void add(shelf, done)}
                  >
                    {label}
                  </Button>
                ))}
              </Flex>
              {outcome?.kind === 'adding' && <Loading>Adding…</Loading>}
              {outcome?.kind === 'added' && <Status>{outcome.text}</Status>}
              {outcome?.kind === 'failed' && <Alert>Something went wrong: {outcome.message}</Alert>}
            </Flex>
          </div>
        </div>
      </Card>
    </li>
  );
}

/** Looks books up in the catalog and puts the one a reader picks on their shelf. */
export default function SearchPage() {
  const { profileId = '' } = useParams();
  const client = useApolloClient();
  const [text, setText] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Null until a search has run, so "no results" is not shown before anyone has searched.
  const [hits, setHits] = useState<{ query: string; books: SearchHit[] } | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    const query = text.trim();
    if (!query || searching) return;
    setSearching(true);
    setError(null);
    try {
      // Always ask the catalog: a second search for the same words should not be answered from a cache.
      const result = await client.query<{ searchBooks: SearchHit[] }>({
        query: SEARCH_BOOKS,
        variables: { query },
        fetchPolicy: 'network-only',
      });
      setHits({ query, books: result.data?.searchBooks ?? [] });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  return (
    <Flex direction="column" gap="5">
      <Heading as="h1" size={{ initial: '7', sm: '8' }}>
        Find a book
      </Heading>
      <form onSubmit={(event) => void search(event)}>
        <Flex gap="3" align="end" wrap="wrap">
          <div style={{ flex: '1 1 16rem' }}>
            <Field label="Title, author or ISBN">
              <TextField.Root
                size="3"
                value={text}
                maxLength={MAX_QUERY_LENGTH}
                onChange={(event) => setText(event.target.value)}
              >
                <TextField.Slot>
                  <MagnifyingGlassIcon aria-hidden="true" />
                </TextField.Slot>
              </TextField.Root>
            </Field>
          </div>
          <Button type="submit" size="3" disabled={searching || !text.trim()}>
            Search
          </Button>
        </Flex>
      </form>
      {searching && <Loading>Searching…</Loading>}
      {error && <Alert>Something went wrong: {error}</Alert>}
      {hits &&
        !searching &&
        (hits.books.length === 0 ? (
          <Text color="gray">No books found for “{hits.query}”.</Text>
        ) : (
          <ul className="card-list">
            {hits.books.map((hit) => (
              <Hit key={hit.sourceId ?? hit.title} hit={hit} profileId={profileId} />
            ))}
          </ul>
        ))}
      <Text>
        Can’t find it? <TextLink to={`/p/${profileId}/add`}>Add it yourself</TextLink>
      </Text>
      <Flex>
        <Button asChild variant="ghost" color="gray">
          <Link to={`/p/${profileId}`}>Back to the shelves</Link>
        </Button>
      </Flex>
    </Flex>
  );
}
