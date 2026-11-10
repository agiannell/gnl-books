import { CombinedGraphQLErrors } from '@apollo/client/errors';
import { useApolloClient } from '@apollo/client/react';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import type { ParentSession, ParentUnlock } from './parentSession.ts';
import { RENEW_PARENT_UNLOCK, UNLOCK_PARENT } from './queries.ts';

/** How the PIN was received. A wrong PIN and a lockout are the reader's to see; anything else is a fault. */
export type UnlockResult =
  | { ok: true }
  | { ok: false; reason: 'incorrect'; attemptsRemaining: number | null }
  | { ok: false; reason: 'locked'; retryAt: Date | null }
  | { ok: false; reason: 'error'; message: string };

interface ParentControls {
  unlocked: boolean;
  unlock: (pin: string) => Promise<UnlockResult>;
  lock: () => void;
}

const ParentSessionContext = createContext<ParentControls | null>(null);

// The token slides for 2 minutes on the server, so asking for a new one this often while
// the parent is active keeps it alive; an idle parent's token simply runs out.
const RENEW_AFTER_MS = 30_000;

type TokenReply = { token: string; expiresAt: string };

const toUnlock = ({ token, expiresAt }: TokenReply): ParentUnlock => ({ token, expiresAt: Date.parse(expiresAt) });

/**
 * Holds the parent unlock for the whole app and keeps it short: it locks when the token
 * runs out, when the tab is hidden, and when asked. While a parent is busy it renews the
 * token, so the 2-minute window slides (the server stops it after 15 minutes from the PIN).
 * Must sit inside the Apollo provider.
 */
export function ParentSessionProvider({ session, children }: { session: ParentSession; children: ReactNode }) {
  const client = useApolloClient();
  const unlock = useSyncExternalStore(session.subscribe, session.get);
  const renewing = useRef(false);
  const lastRenewed = useRef(0);

  const lock = useCallback(() => session.set(null), [session]);

  const submitPin = useCallback(
    async (pin: string): Promise<UnlockResult> => {
      try {
        const result = await client.mutate<{ unlockParent: TokenReply }>({ mutation: UNLOCK_PARENT, variables: { pin } });
        if (!result.data) throw new Error('The API sent no unlock');
        lastRenewed.current = Date.now();
        session.set(toUnlock(result.data.unlockParent));
        return { ok: true };
      } catch (caught) {
        if (CombinedGraphQLErrors.is(caught)) {
          const { code, attemptsRemaining, retryAt } = caught.errors[0]?.extensions ?? {};
          if (code === 'PIN_INCORRECT') {
            return { ok: false, reason: 'incorrect', attemptsRemaining: typeof attemptsRemaining === 'number' ? attemptsRemaining : null };
          }
          if (code === 'PIN_LOCKED') {
            return { ok: false, reason: 'locked', retryAt: typeof retryAt === 'string' ? new Date(retryAt) : null };
          }
        }
        return { ok: false, reason: 'error', message: caught instanceof Error ? caught.message : String(caught) };
      }
    },
    [client, session],
  );

  // While unlocked: lock at expiry, lock when the tab is hidden, and renew on activity.
  const expiresAt = unlock?.expiresAt;
  useEffect(() => {
    if (expiresAt === undefined) return;
    const timer = setTimeout(lock, Math.max(0, expiresAt - Date.now()));
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') lock();
    };
    const onActivity = () => {
      if (renewing.current || Date.now() - lastRenewed.current < RENEW_AFTER_MS) return;
      renewing.current = true;
      client
        .mutate<{ renewParentUnlock: TokenReply }>({ mutation: RENEW_PARENT_UNLOCK })
        .then((result) => {
          lastRenewed.current = Date.now();
          // Only if still unlocked: a lock while the call was out must stay locked.
          if (result.data && session.get()) session.set(toUnlock(result.data.renewParentUnlock));
        })
        // A refusal means the token is spent (the 15-minute cap, or it already ran out).
        .catch(lock)
        .finally(() => {
          renewing.current = false;
        });
    };
    document.addEventListener('visibilitychange', onVisibility);
    document.addEventListener('pointerdown', onActivity);
    document.addEventListener('keydown', onActivity);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('pointerdown', onActivity);
      document.removeEventListener('keydown', onActivity);
    };
  }, [expiresAt, client, session, lock]);

  const controls = useMemo<ParentControls>(
    () => ({ unlocked: unlock !== null, unlock: submitPin, lock }),
    [unlock, submitPin, lock],
  );
  return <ParentSessionContext value={controls}>{children}</ParentSessionContext>;
}

export function useParentSession(): ParentControls {
  const controls = useContext(ParentSessionContext);
  if (!controls) throw new Error('useParentSession needs a ParentSessionProvider');
  return controls;
}
