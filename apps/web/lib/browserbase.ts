import Browserbase from '@browserbasehq/sdk';

let client: Browserbase | null | undefined;

/**
 * Server-only Browserbase client. Returns null when no key is configured so
 * routes can degrade to a clear 501 instead of throwing at import time — the
 * dashboard has to run before any key exists.
 */
export function getBrowserbase(): Browserbase | null {
  if (client !== undefined) return client;
  const apiKey = process.env.BROWSERBASE_API_KEY;
  client = apiKey ? new Browserbase({ apiKey }) : null;
  return client;
}
