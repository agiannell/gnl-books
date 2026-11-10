import { Card, Flex, Heading, Text } from '@radix-ui/themes';
import { Link } from 'react-router';
import Cover from './Cover.tsx';
import { formatDate, seriesLabel, stars } from './format.ts';
import type { ShelfItem, ShelfName } from './queries.ts';

// In the order a reader cares about: what they are in the middle of first.
const SECTIONS: { shelf: ShelfName; title: string; empty: string }[] = [
  { shelf: 'CURRENTLY_READING', title: 'Reading now', empty: 'Nothing being read right now.' },
  { shelf: 'TO_READ', title: 'Want to read', empty: 'No books waiting.' },
  { shelf: 'READ', title: 'Read', empty: 'No finished books yet.' },
];

function Entry({ item, profileId }: { item: ShelfItem; profileId: string }) {
  const { book } = item;
  const seriesText = seriesLabel(book);
  const reading = item.shelf === 'CURRENTLY_READING' && item.currentPage !== null;
  return (
    <li>
      <Card size="2">
        <div className="book-row">
          <Cover url={book.coverUrl} />
          <div className="book-body">
            <Flex direction="column" gap="1">
              {/* The link's own area is stretched over the whole card (see index.css), so the card is the tap target. */}
              <Link to={`/p/${profileId}/book/${book.id}`} className="book-title">
                {book.title}
              </Link>
              <Text as="div" size="2" color="gray">
                by {book.authors.join(', ')}
              </Text>
              {seriesText && (
                <Text as="div" size="2" color="gray">
                  {seriesText}
                </Text>
              )}
              {reading && (
                <>
                  <Text as="div" size="2">
                    {book.pages ? `Page ${item.currentPage} of ${book.pages}` : `Page ${item.currentPage}`}
                  </Text>
                  {/* The words above say it; the bar is only for the eye. */}
                  {book.pages ? <progress aria-hidden="true" value={Math.min(item.currentPage!, book.pages)} max={book.pages} /> : null}
                </>
              )}
              {item.shelf === 'READ' && item.rating !== null && (
                <div role="img" aria-label={`${item.rating} out of 5 stars`} className="stars">
                  {stars(item.rating)}
                </div>
              )}
              {item.shelf === 'READ' && item.dateRead && (
                <Text as="div" size="2" color="gray">
                  Finished {formatDate(item.dateRead)}
                </Text>
              )}
            </Flex>
          </div>
        </div>
      </Card>
    </li>
  );
}

/** A reader's books in three lists, each book with its cover. */
export default function Shelves({ items, profileId }: { items: ShelfItem[]; profileId: string }) {
  return (
    <Flex direction="column" gap="6">
      {SECTIONS.map(({ shelf, title, empty }) => {
        const entries = items.filter((item) => item.shelf === shelf);
        return (
          <section key={shelf} aria-labelledby={`shelf-${shelf}`}>
            <Heading as="h2" size="5" mb="3" id={`shelf-${shelf}`}>
              {title} ({entries.length})
            </Heading>
            {entries.length === 0 ? (
              <Text as="p" color="gray">
                {empty}
              </Text>
            ) : (
              <ul className="card-grid">
                {entries.map((item) => (
                  <Entry key={item.id} item={item} profileId={profileId} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </Flex>
  );
}
