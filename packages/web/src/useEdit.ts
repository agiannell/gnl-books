import { useApolloClient } from '@apollo/client/react';
import { useState } from 'react';

/**
 * Runs one change at a time and keeps what the reader needs to see: that it is running, or why
 * it failed. `edit` resolves to whether the change worked, so a form can clear itself only on success.
 */
export function useEdit() {
  const client = useApolloClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function edit(mutation: Parameters<typeof client.mutate>[0]): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await client.mutate(mutation);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { edit, busy, error };
}

export type Edit = ReturnType<typeof useEdit>['edit'];
