import { gql } from '@apollo/client';
import { type DocumentNode, Kind, type SelectionSetNode, visit } from 'graphql';
import { describe, expect, it } from 'vitest';
import {
  BOOK_PAGE,
  FAMILY,
  PROFILE,
  SEARCH_BOOKS,
  SETTINGS_GOALS,
  SETTINGS_PROFILES,
  SETTINGS_TIMEZONE,
} from '../src/queries.ts';

// The fake API in the other tests answers with an `id` whether or not a query asked for it, so
// they cannot see a query that forgot it. A real server sends only what was asked for.
const fieldsOf = (selectionSet: SelectionSetNode | undefined) =>
  (selectionSet?.selections ?? []).flatMap((s) => (s.kind === Kind.FIELD ? [s] : []));

const familyFields = (doc: DocumentNode) => {
  const operation = doc.definitions.find((d) => d.kind === Kind.OPERATION_DEFINITION);
  if (operation?.kind !== Kind.OPERATION_DEFINITION) throw new Error('no operation');
  const family = fieldsOf(operation.selectionSet).find((f) => f.name.value === 'family');
  return fieldsOf(family?.selectionSet).map((f) => f.name.value);
};

/** Every field name a document asks for, anywhere in it. */
const fieldNames = (doc: DocumentNode) => {
  const names = new Set<string>();
  visit(doc, { Field: (node) => void names.add(node.name.value) });
  return names;
};

// The fake API in the other tests answers with a `coverUrl` whether or not a query asked for it, so a
// query that forgot it would still show covers in the tests and none in the real app.
describe('the queries that show books', () => {
  it.each([
    ['ProfilePage', PROFILE],
    ['BookPage', BOOK_PAGE],
    ['SearchBooks', SEARCH_BOOKS],
  ])('%s asks for the cover', (_name, doc) => {
    expect(fieldNames(doc).has('coverUrl')).toBe(true);
  });

  it('sees a query that leaves it out', () => {
    expect(fieldNames(FAMILY).has('coverUrl')).toBe(false);
  });
});

describe('the queries that read the family', () => {
  // With the id, Apollo keeps the family as one object and merges what each query reads. Without it a
  // query that skips `name` replaces the whole object, and the others ask the API again.
  it.each([
    ['Family', FAMILY],
    ['SettingsProfiles', SETTINGS_PROFILES],
    ['SettingsGoals', SETTINGS_GOALS],
    ['SettingsTimezone', SETTINGS_TIMEZONE],
  ])('%s asks for the family’s id', (_name, doc) => {
    expect(familyFields(doc)).toContain('id');
  });

  it('sees a query that leaves it out', () => {
    const without = gql`
      query Without {
        family {
          name
        }
      }
    `;
    expect(familyFields(without)).toEqual(['name']);
  });
});
