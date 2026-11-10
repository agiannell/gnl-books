import { describe, expect, it } from 'vitest';
import { MIN_READER_SHARE, normalize, worthShowing } from '../src/books/relevance';

const hit = (id: number, title: string, usersCount?: number, over: Record<string, unknown> = {}) => ({
  id,
  title,
  ...(usersCount !== undefined && { usersCount }),
  ...over,
});
const titles = (hits: unknown[], query: string) => (worthShowing(hits, query) as { title: string }[]).map((h) => h.title);

describe('normalize', () => {
  it.each([
    ['Dog Man: Fetch-22', 'dog man fetch 22'],
    ['  Harry   Potter ', 'harry potter'],
    ['Café Society', 'cafe society'],
    ["Charlotte's Web", 'charlotte s web'],
    ['J.K. Rowling', 'j k rowling'],
    ['ÅNGSTRÖM', 'angstrom'],
    ['名前', '名前'],
    ['!!!', ''],
    ['', ''],
  ])('turns %j into %j', (text, expected) => {
    expect(normalize(text)).toBe(expected);
  });
});

describe('the books that contain the whole search phrase come first, most-read first', () => {
  it('puts a series’ books in reader order, though only some have its name in the title', () => {
    // The shape of a real search for "percy jackson": the title matches come first from Hardcover,
    // and the real books, found through their series, come later.
    const series = ['Percy Jackson and the Olympians'];
    const hits = [
      hit(1, 'Percy Jackson and the Singer of Apollo', 153, { seriesNames: series }),
      hit(2, 'Percy Jackson and the Stolen Chariot', 49, { seriesNames: series }),
      hit(3, 'The Lightning Thief', 6523, { seriesNames: series }),
      hit(4, 'The Sea of Monsters', 4045, { seriesNames: series }),
      hit(5, 'The Last Olympian', 3537, { seriesNames: series }),
    ];
    expect(titles(hits, 'percy jackson')).toEqual([
      'The Lightning Thief',
      'The Sea of Monsters',
      'The Last Olympian',
      'Percy Jackson and the Singer of Apollo',
      'Percy Jackson and the Stolen Chariot',
    ]);
  });

  it('does not count a book that has both words but not together', () => {
    const hits = [
      hit(1, 'Dog Man', 115, { authorNames: ['Dav Pilkey'] }),
      hit(2, 'Chainsaw Man, Vol. 1: Dog and Chainsaw', 564, { authorNames: ['Tatsuki Fujimoto'] }),
      hit(3, 'Dog Man: Fetch-22', 40, { authorNames: ['Dav Pilkey'] }),
      hit(4, 'Captain Underpants', 161, { authorNames: ['Dav Pilkey'] }),
    ];
    // Chainsaw Man has 564 readers but is not about Dog Man and not by its author, so it is not shown; Captain
    // Underpants, by the same author, is, after the books that match.
    expect(titles(hits, 'dog man')).toEqual(['Dog Man', 'Dog Man: Fetch-22', 'Captain Underpants']);
  });

  it('keeps the related ones in Hardcover’s order, after the matches', () => {
    const by = { authorNames: ['An Author'] };
    const hits = [hit(1, 'Related one', 10, by), hit(2, 'Related two', 900, by), hit(3, 'Match', 5, { seriesNames: ['Match'], ...by })];
    expect(titles(hits, 'match')).toEqual(['Match', 'Related one', 'Related two']);
  });

  it('puts a hit with no reader count last among the matches, and keeps ties in Hardcover’s order', () => {
    const hits = [hit(1, 'Dog Man A'), hit(2, 'Dog Man B', 7), hit(3, 'Dog Man C', 7), hit(4, 'Dog Man D', 50)];
    expect(titles(hits, 'dog man')).toEqual(['Dog Man D', 'Dog Man B', 'Dog Man C', 'Dog Man A']);
  });

  // A book that contains the phrase is kept; an unrelated one beside it is dropped. (With no match at all everything
  // would be kept, so seeing the unrelated one go proves the match was recognised.)
  describe('where the phrase can be', () => {
    it.each([
      ['the title', { title: 'Dog Man Unleashed' }],
      ['the subtitle', { title: 'Unleashed', subtitle: 'A Dog Man Adventure' }],
      ['a series name', { title: 'Fetch-22', seriesNames: ['Dog Man'] }],
      ['an author’s name', { title: 'Anything', authorNames: ['Dog Man Jr'] }],
      ['an ISBN', { title: 'Anything', isbns: ['dog man'] }],
    ])('in %s', (_where, fields) => {
      const hits = [hit(1, 'Unrelated', 100, { authorNames: ['Nobody'] }), { id: 2, usersCount: 1, ...fields }];
      expect((worthShowing(hits, 'dog man') as { id: number }[]).map((h) => h.id)).toEqual([2]);
    });

    // From a real search for "dog man": the Captain Underpants books list marketing editions as other titles.
    it('not in another title, which publishers use for tag lines', () => {
      const hits = [
        hit(1, 'Dog Man', 115, { authorNames: ['Dav Pilkey'] }),
        hit(2, 'The Adventures of Captain Underpants', 161, {
          authorNames: ['Dav Pilkey'],
          alternativeTitles: ['The Adventures of Captain Underpants (Now With a Dog Man Comic!): 25 1/2 Anniversary Edition'],
        }),
        hit(3, 'Dog Man: Fetch-22', 40, { authorNames: ['Dav Pilkey'] }),
      ];
      // Captain Underpants has more readers, but it is not a match, so it comes after the Dog Man books.
      expect(titles(hits, 'dog man')).toEqual(['Dog Man', 'Dog Man: Fetch-22', 'The Adventures of Captain Underpants']);
    });

    it('as whole words, so "man" is not found in "manual" and "potter" not in "pottery"', () => {
      expect(titles([hit(1, 'The Manual', 100), hit(2, 'Man', 1)], 'man')).toEqual(['Man']);
      expect(titles([hit(1, 'Pottery', 100), hit(2, 'Potter', 1)], 'potter')).toEqual(['Potter']);
    });

    it('whatever the case, accents or punctuation', () => {
      expect(titles([hit(1, 'Other', 100), hit(2, 'Café Society', 1)], 'CAFE-society')).toEqual(['Café Society']);
      expect(titles([hit(1, 'Other', 100), hit(2, "Harry Potter's Year", 1)], 'harry potter')).toEqual(["Harry Potter's Year"]);
    });

    it('not at all when the query has no letters or digits, so nothing is promoted', () => {
      expect(titles([hit(1, 'A', 10), hit(2, 'B', 900)], '???')).toEqual(['A', 'B']);
    });
  });
});

describe('related books', () => {
  const matches = [
    hit(1, 'Harry Potter and the Stone', 17000, { authorNames: ['J.K. Rowling', 'Mary GrandPré'], seriesNames: ['Harry Potter'] }),
    hit(2, 'Harry Potter and the Chamber', 13000, { authorNames: ['J.K. Rowling'], seriesNames: ['Harry Potter'] }),
  ];

  it('are shown after the matches when they have the same author', () => {
    const beedle = hit(3, 'The Tales of Beedle the Bard', 1700, { authorNames: ['J.K. Rowling'] });
    expect(titles([...matches, beedle], 'harry potter')).toEqual([
      'Harry Potter and the Stone',
      'Harry Potter and the Chamber',
      'The Tales of Beedle the Bard',
    ]);
  });

  it('are shown when they are in the same series, whoever the author', () => {
    const spinOff = hit(3, 'A Spin-off', 900, { authorNames: ['Someone Else'], seriesNames: ['Harry Potter'] });
    expect(titles([...matches, spinOff], 'harry potter')).toContain('A Spin-off');
  });

  it('are shown when they are in a series that a match is in, though the series name is not the search', () => {
    // Nothing here contains "percy jackson" except one title; the others are found through the series they share.
    const hits = [
      hit(1, 'Percy Jackson and the Lightning Thief', 6523, { authorNames: ['Rick Riordan'], seriesNames: ['Olympus'] }),
      hit(2, 'Sea of Monsters', 4045, { authorNames: ['A Different Author'], seriesNames: ['Olympus'] }),
      hit(3, 'Elsewhere', 4000, { authorNames: ['A Different Author'], seriesNames: ['Somewhere Else'] }),
    ];
    expect(titles(hits, 'percy jackson')).toEqual(['Percy Jackson and the Lightning Thief', 'Sea of Monsters']);
  });

  it('are shown when they share the main author, whoever else is listed beside them', () => {
    const other = hit(3, 'Another By Her', 900, { authorNames: ['J.K. Rowling', 'Olly Moss'] });
    expect(titles([...matches, other], 'harry potter')).toContain('Another By Her');
  });

  it('are not shown when they only share an illustrator or a co-author', () => {
    const other = hit(3, 'Some Other Book', 900, { authorNames: ['Someone Else', 'Mary GrandPré'] });
    expect(titles([...matches, other], 'harry potter')).not.toContain('Some Other Book');
  });

  it('are matched to an author whatever the case or punctuation of the name', () => {
    const same = hit(3, 'By the same hand', 900, { authorNames: ['j.k. rowling'] });
    expect(titles([...matches, same], 'harry potter')).toContain('By the same hand');
  });

  it('are not shown when they belong to someone else, however popular', () => {
    const bestseller = hit(3, 'The Man Who Died Twice', 1_000_000, { authorNames: ['Richard Osman'] });
    expect(titles([...matches, bestseller], 'harry potter')).toEqual(['Harry Potter and the Stone', 'Harry Potter and the Chamber']);
  });

  it('are not shown when they have no author or series listed', () => {
    expect(titles([...matches, hit(3, 'Mystery', 900)], 'harry potter')).not.toContain('Mystery');
  });

  it('are all kept, in Hardcover’s order, when nothing contains the whole phrase, because nothing can be judged', () => {
    const hits = [hit(1, 'Hobbit Tales', 500, { authorNames: ['A'] }), hit(2, 'Elsewhere', 400, { authorNames: ['B'] })];
    expect(titles(hits, 'hobit')).toEqual(['Hobbit Tales', 'Elsewhere']);
  });

  it('still go through the readers floor', () => {
    const beedle = hit(3, 'A Tiny Rowling Listing', 2, { authorNames: ['J.K. Rowling'] });
    expect(titles([...matches, beedle], 'harry potter')).not.toContain('A Tiny Rowling Listing');
  });
});

describe('the share of readers', () => {
  it('is half a percent', () => {
    expect(MIN_READER_SHARE).toBe(0.005);
  });

  it('is measured against the best hit that has the whole phrase, not a popular book that matched one word', () => {
    const hits = [hit(1, 'Dog Man', 115), hit(2, 'The Man Who Died Twice', 1_000_000, { authorNames: ['Richard Osman'] }), hit(3, 'Dog Man: Fetch-22', 40)];
    // If the million counted, the floor would be 5,000 and the Dog Man books would be hidden.
    expect(titles(hits, 'dog man')).toEqual(['Dog Man', 'Dog Man: Fetch-22']);
  });

  it('is measured against everything when nothing has the whole phrase', () => {
    expect(titles([hit(1, 'Top', 1000), hit(2, 'Edge', 5), hit(3, 'Below', 4)], 'zzz')).toEqual(['Top', 'Edge']);
  });

  it('applies to the books that match the phrase, too', () => {
    const hits = [hit(1, 'Harry Potter and the Stone', 17000), hit(2, 'Harry Potter y la piedra', 5), hit(3, 'Harry Potter: The Prequel', 379)];
    expect(titles(hits, 'harry potter')).toEqual(['Harry Potter and the Stone', 'Harry Potter: The Prequel']);
  });

  it('keeps a match that does not say how many readers it has, last among the matches, and the malformed hits', () => {
    const result = worthShowing([hit(1, 'Top', 1000), hit(2, 'Top Two'), null, 'text'], 'top');
    expect(result).toEqual([hit(1, 'Top', 1000), hit(2, 'Top Two'), null, 'text']);
  });
});

describe('compilations', () => {
  it('are dropped, and do not set the bar', () => {
    expect(titles([hit(1, 'Box set', 90000, { compilation: true }), hit(2, 'The book', 200)], 'book')).toEqual(['The book']);
  });

  it('are all shown when nothing else is', () => {
    expect(titles([hit(1, 'Box 1', 10, { compilation: true }), hit(2, 'Box 2', 20, { compilation: true })], 'box')).toEqual(['Box 2', 'Box 1']);
  });
});

it('shows nothing for no hits, and never throws on odd input', () => {
  expect(worthShowing([], 'x')).toEqual([]);
  expect(() => worthShowing([undefined, 7, [], { title: 5, seriesNames: 'x', authorNames: [1, null] }], 'x')).not.toThrow();
});
