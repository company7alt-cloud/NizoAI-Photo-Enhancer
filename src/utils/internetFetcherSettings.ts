import fs   from 'fs';
import path from 'path';

const STATE_FILE = path.join(process.cwd(), 'internet_fetcher_state.json');

export interface FetcherState {
  enabled:     boolean;
  lastChanged: string;
}

function readState(): FetcherState {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      const d: FetcherState = {
        enabled:     true,
        lastChanged: new Date().toISOString(),
      };
      fs.writeFileSync(STATE_FILE, JSON.stringify(d, null, 2));
      return d;
    }
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as FetcherState;
  } catch {
    return { enabled: true, lastChanged: new Date().toISOString() };
  }
}

export function isInternetFetcherEnabled(): boolean {
  return readState().enabled !== false;
}

export function toggleInternetFetcher(): boolean {
  const cur = readState();
  const next: FetcherState = {
    enabled:     !cur.enabled,
    lastChanged: new Date().toISOString(),
  };
  fs.writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next.enabled;
}

export function getFetcherStatus(): FetcherState {
  return readState();
}
