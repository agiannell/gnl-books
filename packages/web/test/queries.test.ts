import { gql } from '@apollo/client';
import { type DocumentNode, Kind, type SelectionSetNode } from 'graphql';
import { describe, expect, it } from 'vitest';
import { FAMILY, SETTINGS_GOALS, SETTINGS_PROFILES } from '../src/queries.ts';

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

describe('the queries that read the family', () => {
  // With the id, Apollo keeps the family as one object and merges what each query reads. Without it a
  // query that skips `name` replaces the whole object, and the others ask the API again.
  it.each([
    ['Family', FAMILY],
    ['SettingsProfiles', SETTINGS_PROFILES],
    ['SettingsGoals', SETTINGS_GOALS],
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
