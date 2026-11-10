/** A parent unlock: the signed token the API expects, and when it stops working. */
export interface ParentUnlock {
  token: string;
  /** Milliseconds since the epoch. */
  expiresAt: number;
}

/**
 * Where the unlock token lives: in memory, and nowhere else. The API says the token is
 * meant to be held in memory, so a reload locks again, and a script cannot find it in
 * storage. It is a plain store, outside React, so the API client can read the current
 * token on every request.
 */
export function createParentSession() {
  let current: ParentUnlock | null = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    getToken: () => current?.token,
    set(unlock: ParentUnlock | null) {
      current = unlock;
      listeners.forEach((listener) => listener());
    },
    /** For `useSyncExternalStore`: returns the way to stop listening. */
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export type ParentSession = ReturnType<typeof createParentSession>;
