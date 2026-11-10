import { useApolloClient } from '@apollo/client/react';
import { Button, Card, Flex, Grid, Heading, Text, TextField } from '@radix-ui/themes';
import { type FormEvent, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { ADD_MANUAL_BOOK, ADD_TO_SHELF, type ShelfName } from './queries.ts';
import { Alert, Field, Loading, Status, TextLink } from './ui.tsx';

const SHELVES: { shelf: ShelfName; label: string }[] = [
  { shelf: 'TO_READ', label: 'Want to read' },
  { shelf: 'CURRENTLY_READING', label: 'Reading now' },
  { shelf: 'READ', label: 'Already read' },
];

/** A whole number from a text box, null when it is empty, or undefined when it is not a number. */
function wholeNumber(text: string): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return /^\d+$/.test(trimmed) ? Number(trimmed) : undefined;
}

/** For a book the catalog does not have: type it in and put it on the reader's shelf. */
export default function ManualAddPage() {
  const { profileId = '' } = useParams();
  const client = useApolloClient();
  const [title, setTitle] = useState('');
  const [authors, setAuthors] = useState('');
  const [pages, setPages] = useState('');
  const [year, setYear] = useState('');
  const [shelf, setShelf] = useState<ShelfName>('TO_READ');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  // The book is saved before it is shelved. If shelving fails, trying again with the same
  // details must reuse that book: manual books are not matched up, so a second save would be a duplicate.
  const saved = useRef<{ key: string; bookId: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setAdded(null);
    const authorList = authors
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean);
    const pageCount = wholeNumber(pages);
    const releaseYear = wholeNumber(year);
    if (!title.trim()) return setError('Give the book a title');
    if (authorList.length === 0) return setError('Give at least one author');
    if (pageCount === undefined) return setError('Pages must be a whole number');
    if (releaseYear === undefined) return setError('Year must be a whole number');

    const input = { title: title.trim(), authors: authorList, pages: pageCount, releaseYear };
    const key = JSON.stringify(input);
    setError(null);
    setBusy(true);
    try {
      let bookId = saved.current?.key === key ? saved.current.bookId : undefined;
      if (!bookId) {
        const result = await client.mutate<{ addManualBook: { id: string } }>({
          mutation: ADD_MANUAL_BOOK,
          variables: { input },
        });
        bookId = result.data?.addManualBook.id;
        if (!bookId) throw new Error('The book could not be saved');
        saved.current = { key, bookId };
      }
      await client.mutate({ mutation: ADD_TO_SHELF, variables: { profileId, bookId, shelf } });
      const label = SHELVES.find((s) => s.shelf === shelf)!.label;
      setAdded(`Added “${input.title}” to ${label}`);
      saved.current = null;
      setTitle('');
      setAuthors('');
      setPages('');
      setYear('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Flex direction="column" gap="5">
      <Heading as="h1" size={{ initial: '7', sm: '8' }}>
        Add a book yourself
      </Heading>
      <Card size="3">
        <form onSubmit={(event) => void submit(event)}>
          <Flex direction="column" gap="4">
            <Field label="Title">
              <TextField.Root size="3" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field label="Authors, separated by commas">
              <TextField.Root size="3" value={authors} onChange={(e) => setAuthors(e.target.value)} />
            </Field>
            <Grid columns={{ initial: '1', sm: '2' }} gap="4">
              <Field label="Pages (optional)">
                <TextField.Root size="3" value={pages} inputMode="numeric" onChange={(e) => setPages(e.target.value)} />
              </Field>
              <Field label="Year published (optional)">
                <TextField.Root size="3" value={year} inputMode="numeric" onChange={(e) => setYear(e.target.value)} />
              </Field>
            </Grid>
            <Field label="Shelf">
              <select className="native" value={shelf} onChange={(e) => setShelf(e.target.value as ShelfName)}>
                {SHELVES.map((s) => (
                  <option key={s.shelf} value={s.shelf}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Flex>
              <Button type="submit" size="3" disabled={busy}>
                Add book
              </Button>
            </Flex>
            {busy && <Loading>Adding…</Loading>}
            {added && <Status>{added}</Status>}
            {error && <Alert>{error}</Alert>}
          </Flex>
        </form>
      </Card>
      <Text>
        <TextLink to={`/p/${profileId}/search`}>Back to search</TextLink> ·{' '}
        <TextLink to={`/p/${profileId}`}>Back to the shelves</TextLink>
      </Text>
    </Flex>
  );
}
