import { vi } from 'vitest';

/** One request the app made to the API. */
export interface Call {
  operationName: string;
  authorization: string | null;
}

/**
 * A stand-in for `fetch` that answers GraphQL requests by operation name. Each
 * handler's value is the whole JSON response body: `{ data }` or `{ errors }`.
 */
export function fakeApi(handlers: Record<string, unknown>) {
  const calls: Call[] = [];
  const urls: string[] = [];
  const fetch = vi.fn(async (url: unknown, init?: RequestInit) => {
    urls.push(String(url));
    const { operationName } = JSON.parse(String(init?.body)) as { operationName: string };
    calls.push({ operationName, authorization: new Headers(init?.headers).get('authorization') });
    if (!(operationName in handlers)) throw new Error(`unexpected operation ${operationName}`);
    return new Response(JSON.stringify(handlers[operationName]), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls, urls };
}
