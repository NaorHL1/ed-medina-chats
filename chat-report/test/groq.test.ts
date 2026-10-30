import { describe, expect, it } from 'vitest';
import { GroqClient } from '../src/pipeline/groq.js';

describe('GroqClient', () => {
  it('sends the key only in the Authorization header and returns message content', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url: String(url), init };
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
    }) as typeof fetch;

    const client = new GroqClient({ apiKey: 'test-key', model: 'test-model', fetch: fakeFetch });
    expect(await client.complete('writer', 'hello')).toBe('{"ok":true}');

    expect(seen!.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    const body = JSON.parse(String(seen!.init.body));
    expect(body.model).toBe('test-model');
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[1].content).toBe('hello');
    expect(JSON.stringify(body)).not.toContain('test-key');
  });

  it('throws on HTTP errors without echoing the key', async () => {
    const fakeFetch = (async () => new Response('nope', { status: 401 })) as typeof fetch;
    const client = new GroqClient({ apiKey: 'secret-value', model: 'm', fetch: fakeFetch });
    await expect(client.complete('judge', 'x')).rejects.toThrow('HTTP 401');
  });

  it('retries a rate-limited call and honours Retry-After', async () => {
    const waits: number[] = [];
    const statuses = [429, 503, 200];
    const fakeFetch = (async () => {
      const status = statuses.shift()!;
      const headers: Record<string, string> = status === 429 ? { 'retry-after': '3' } : {};
      return status === 200
        ? new Response(JSON.stringify({ choices: [{ message: { content: 'done' } }] }), { status })
        : new Response('busy', { status, headers });
    }) as typeof fetch;

    const client = new GroqClient({
      apiKey: 'k',
      model: 'm',
      fetch: fakeFetch,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
    expect(await client.complete('writer', 'x')).toBe('done');
    expect(waits).toEqual([3000, 4000]);
  });

  it('gives up after the retry limit and reports the status', async () => {
    const fakeFetch = (async () => new Response('busy', { status: 429 })) as typeof fetch;
    const client = new GroqClient({ apiKey: 'k', model: 'm', fetch: fakeFetch, maxRetries: 2, sleep: async () => {} });
    await expect(client.complete('judge', 'x')).rejects.toThrow('HTTP 429');
  });

  it('refuses to start without a key', () => {
    expect(() => new GroqClient({ apiKey: '', model: 'm' })).toThrow('needs an API key');
  });
});
