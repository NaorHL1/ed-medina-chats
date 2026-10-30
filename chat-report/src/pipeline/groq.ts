import type { ModelClient, Stage } from './run.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface GroqClientOptions {
  apiKey: string;
  model: string;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  temperature?: number;
}

/** Calls Groq's OpenAI-compatible chat endpoint. The key is only sent in the Authorization header. */
export class GroqClient implements ModelClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: GroqClientOptions) {
    if (!options.apiKey) throw new Error('GroqClient needs an API key');
    this.fetchImpl = options.fetch ?? fetch;
  }

  async complete(stage: Stage, prompt: string): Promise<string> {
    const response = await this.fetchImpl(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: this.options.temperature ?? 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `Stage: ${stage}. Reply with JSON only.` },
          { role: 'user', content: prompt },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Groq ${stage} call failed with HTTP ${response.status}`);
    }
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error(`Groq ${stage} returned no message content`);
    return content;
  }
}
