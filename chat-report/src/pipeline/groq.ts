import type { ModelClient, Stage } from './run.js';

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export interface GroqClientOptions {
  apiKey: string;
  model: string;
  /** Injected for tests; defaults to the global fetch. */
  fetch?: typeof fetch;
  temperature?: number;
  /** Retries after a 429 or 5xx. The free tier rate-limits, so a short wait usually clears it. */
  maxRetries?: number;
  /** Injected for tests; defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
}

const isRetryable = (status: number): boolean => status === 429 || status >= 500;

/** Output budget per stage. Sized to the JSON each stage returns, with room for reasoning tokens. */
const MAX_OUTPUT_TOKENS: Record<Stage, number> = {
  extractor: 2000,
  writer: 2500,
  critic: 1500,
  judge: 800,
  care: 500,
};

/** Honours Retry-After when Groq sends it, otherwise backs off 2, 4, 8 ... seconds. */
export function retryDelayMs(response: Response, attempt: number): number {
  const header = Number(response.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, 60_000);
  return Math.min(2 ** (attempt + 1) * 1000, 60_000);
}

/** Calls Groq's OpenAI-compatible chat endpoint. The key is only sent in the Authorization header. */
export class GroqClient implements ModelClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: GroqClientOptions) {
    if (!options.apiKey) throw new Error('GroqClient needs an API key');
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async complete(stage: Stage, prompt: string): Promise<string> {
    const maxRetries = this.options.maxRetries ?? 5;
    let response = await this.post(stage, prompt);
    for (let attempt = 0; attempt < maxRetries && isRetryable(response.status); attempt++) {
      await this.sleep(retryDelayMs(response, attempt));
      response = await this.post(stage, prompt);
    }

    if (!response.ok) {
      throw new Error(`Groq ${stage} call failed with HTTP ${response.status}`);
    }
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error(`Groq ${stage} returned no message content`);
    return content;
  }

  private post(stage: Stage, prompt: string): Promise<Response> {
    return this.fetchImpl(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.options.model,
        temperature: this.options.temperature ?? 0,
        // Groq counts the output allowance against the per-minute token cap, so each stage asks for only what it needs.
        max_tokens: MAX_OUTPUT_TOKENS[stage],
        // gpt-oss models reason before answering; low effort keeps the JSON inside the budget.
        ...(this.options.model.includes('gpt-oss') ? { reasoning_effort: 'low' } : {}),
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: `Stage: ${stage}. Reply with JSON only.` },
          { role: 'user', content: prompt },
        ],
      }),
    });
  }
}
