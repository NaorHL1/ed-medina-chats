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

  it('refuses to start without a key', () => {
    expect(() => new GroqClient({ apiKey: '', model: 'm' })).toThrow('needs an API key');
  });
});
