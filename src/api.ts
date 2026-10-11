let tokenPromise: Promise<string> | undefined;
async function token(): Promise<string> {
  tokenPromise ||= fetch('/api/session')
    .then(async (r) => {
      if (!r.ok) throw new Error('Cannot open local session');
      return (await r.json()).token as string;
    })
    .catch((e) => {
      tokenPromise = undefined;
      throw e;
    });
  return tokenPromise;
}
export async function api<T>(
  path: string,
  options: { body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const response = await fetch('/api/' + path, {
    method: options.body === undefined ? 'GET' : 'POST',
    headers: {
      'X-Studio-Token': await token(),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const data = await response.json();
  if (!response.ok) {
    if (response.status === 403) tokenPromise = undefined;
    throw new Error(data.error || 'Request failed');
  }
  return data as T;
}
export const query = (values: Record<string, string>) => new URLSearchParams(values).toString();
export async function followLogs(
  body: { context: string; node: string; service: string },
  signal: AbortSignal,
  onText: (text: string) => void,
): Promise<void> {
  const r = await fetch('/api/logs/stream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Studio-Token': await token() },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok || !r.body) {
    const data = await r.json();
    throw new Error(data.error || 'Cannot stream logs');
  }
  const reader = r.body.getReader(),
    decoder = new TextDecoder();
  let pending = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      const lines = pending.split('\n');
      pending = lines.pop() || '';
      for (const line of lines) {
        if (!line) continue;
        const event = JSON.parse(line);
        if (event.error) throw new Error(event.error);
        if (event.text) onText(event.text);
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
