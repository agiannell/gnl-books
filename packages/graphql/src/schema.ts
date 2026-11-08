import { AlreadyBootstrappedError, bootstrapFamily, getFamily, PIN_PATTERN, type Family } from '@gnl-books/core';
import SchemaBuilder from '@pothos/core';
import ScopeAuthPlugin from '@pothos/plugin-scope-auth';
import { GraphQLError } from 'graphql';
import type { Context } from './context';

// All API logic lives here. `lambda.ts` and `dev.ts` only wire it up.

const builder = new SchemaBuilder<{
  Context: Context;
  AuthScopes: { inFamily: boolean; noFamily: boolean; isParent: boolean };
  // The type-level half of the two options below; Pothos needs both.
  DefaultFieldNullability: false;
  DefaultInputFieldRequiredness: true;
}>({
  plugins: [ScopeAuthPlugin],
  // Pothos fields are nullable by default; PLAN.md's schema is non-null, so
  // nullability is something a field opts into (`nullable: true`).
  defaultFieldNullability: false,
  defaultInputFieldRequiredness: true,
  scopeAuth: {
    authScopes: async (context) => ({
      inFamily: context.familyId !== null,
      noFamily: context.familyId === null,
      isParent: context.isParent,
    }),
    // Without this a refused field is reported as INTERNAL_SERVER_ERROR, which
    // a client cannot tell apart from the server breaking.
    unauthorizedError: () =>
      new GraphQLError('Not authorized', { extensions: { code: 'FORBIDDEN' } }),
  },
});

const AccountRef = builder.objectRef<{ cognitoSub: string; familyId: string | null }>('Account');
AccountRef.implement({
  fields: (t) => ({
    // Null means the caller signed in but has not created a family yet.
    familyId: t.exposeID('familyId', { nullable: true }),
  }),
});

const FamilyRef = builder.objectRef<Family>('Family');
FamilyRef.implement({
  fields: (t) => ({
    id: t.exposeID('id'),
    name: t.exposeString('name'),
  }),
});

builder.queryType({
  fields: (t) => ({
    me: t.field({
      type: AccountRef,
      resolve: (_root, _args, ctx) => ({ cognitoSub: ctx.cognitoSub, familyId: ctx.familyId }),
    }),
    family: t.field({
      type: FamilyRef,
      authScopes: { inFamily: true },
      // The id comes from the context, never from an argument.
      resolve: async (_root, _args, ctx) => {
        const family = await getFamily(ctx.db, ctx.familyId!);
        if (!family) throw new GraphQLError('Family not found');
        return family;
      },
    }),
  }),
});

function badInput(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });
}

function requireName(value: string, label: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 60) throw badInput(`${label} must be 1 to 60 characters`);
  return name;
}

builder.mutationType({
  fields: (t) => ({
    // First-run bootstrap. Only a signed-in user with no family can call it, and
    // the account it links is the caller's own, taken from the verified token.
    createFamily: t.field({
      type: FamilyRef,
      authScopes: { noFamily: true },
      args: {
        familyName: t.arg.string(),
        parentName: t.arg.string(),
        pin: t.arg.string(),
      },
      resolve: async (_root, args, ctx) => {
        const familyName = requireName(args.familyName, 'Family name');
        const parentName = requireName(args.parentName, 'Your name');
        if (!PIN_PATTERN.test(args.pin)) throw badInput('PIN must be 4 to 8 digits');
        try {
          return await bootstrapFamily(ctx.db, { cognitoSub: ctx.cognitoSub, familyName, parentName, pin: args.pin });
        } catch (error) {
          if (error instanceof AlreadyBootstrappedError) {
            throw new GraphQLError('You already have a family', { extensions: { code: 'CONFLICT' } });
          }
          throw error;
        }
      },
    }),
  }),
});

export const schema = builder.toSchema();
