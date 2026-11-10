import { Link } from 'react-router';
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
  return (
    <li>
      <strong>
        <Link to={`/p/${profileId}/book/${book.id}`}>{book.title}</Link>
      </strong>
      <div>by {book.authors.join(', ')}</div>
      {seriesText && <div>{seriesText}</div>}
      {item.shelf === 'CURRENTLY_READING' && item.currentPage !== null && (
        <div>{book.pages ? `Page ${item.currentPage} of ${book.pages}` : `Page ${item.currentPage}`}</div>
      )}
      {item.shelf === 'READ' && item.rating !== null && (
        <div role="img" aria-label={`${item.rating} out of 5 stars`}>
          {stars(item.rating)}
        </div>
      )}
      {item.shelf === 'READ' && item.dateRead && <div>Finished {formatDate(item.dateRead)}</div>}
    </li>
  );
}

/** A reader's books in three lists. Text only for now; covers wait for the site's content security policy. */
export default function Shelves({ items, profileId }: { items: ShelfItem[]; profileId: string }) {
  return (
    <>
      {SECTIONS.map(({ shelf, title, empty }) => {
        const entries = items.filter((item) => item.shelf === shelf);
        return (
          <section key={shelf} aria-labelledby={`shelf-${shelf}`}>
            <h2 id={`shelf-${shelf}`}>
              {title} ({entries.length})
            </h2>
            {entries.length === 0 ? (
              <p>{empty}</p>
            ) : (
              <ul>
                {entries.map((item) => (
                  <Entry key={item.id} item={item} profileId={profileId} />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </>
  );
}
