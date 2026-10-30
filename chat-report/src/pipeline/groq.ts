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
  /**
   * Minimum gap between requests. Set it on a rate-limited key so calls never queue up behind
   * the per-minute cap, which a burst of retries would otherwise keep hitting.
   */
  minIntervalMs?: number;
  /** Receives one line per request, retry and wait, so a long run shows what it is doing. */
  log?: (line: string) => void;
}

const isRetryable = (status: number): boolean => status === 429 || status >= 500;

/** Output budget per stage. Sized to the JSON each stage returns, with room for reasoning tokens. */
const MAX_OUTPUT_TOKENS: Record<Stage, number> = {
  extractor: 1200,
  writer: 1800,
  critic: 1200,
  judge: 600,
  care: 300,
};

const MAX_WAIT_MS = 300_000;

/**
 * Waits as long as Groq asks: the Retry-After header, else the "try again in 26.1s" text in the body,
 * else exponential backoff 2, 4, 8 ... seconds.
 */
export function retryDelayMs(response: Response, attempt: number, body = ''): number {
  const header = Number(response.headers.get('retry-after'));
  if (Number.isFinite(header) && header > 0) return Math.min(header * 1000, MAX_WAIT_MS);
  const asked = /try again in ([\d.]+)s/.exec(body);
  if (asked) return Math.min((Number(asked[1]) + 1) * 1000, MAX_WAIT_MS);
  return Math.min(2 ** (attempt + 1) * 1000, MAX_WAIT_MS);
}

/** Calls Groq's OpenAI-compatible chat endpoint. The key is only sent in the Authorization header. */
export class GroqClient implements ModelClient {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private lastSentAt = 0;

  constructor(private readonly options: GroqClientOptions) {
    if (!options.apiKey) throw new Error('GroqClient needs an API key');
    this.fetchImpl = options.fetch ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async complete(stage: Stage, prompt: string): Promise<string> {
    const maxRetries = this.options.maxRetries ?? 12;
    let response = await this.paced(stage, prompt);
    for (let attempt = 0; attempt < maxRetries && isRetryable(response.status); attempt++) {
      const body = await response.text().catch(() => '');
      const wait = retryDelayMs(response, attempt, body);
      this.options.log?.(`${stage}: HTTP ${response.status}, retry ${attempt + 1} in ${Math.round(wait / 1000)}s: ${body.slice(0, 160)}`);
      await this.sleep(wait);
      response = await this.paced(stage, prompt);
    }

    if (!response.ok) {
      throw new Error(`Groq ${stage} call failed with HTTP ${response.status}`);
    }
    const body = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error(`Groq ${stage} returned no message content`);
    return content;
  }

  /** Waits out the minimum gap, then sends. Keeps one request in flight at a time. */
  private async paced(stage: Stage, prompt: string): Promise<Response> {
    const gap = this.options.minIntervalMs ?? 0;
    const wait = this.lastSentAt + gap - Date.now();
    if (gap > 0 && wait > 0) await this.sleep(wait);
    this.options.log?.(`${stage}: sending, prompt ${prompt.length} chars`);
    this.lastSentAt = Date.now();
    return this.post(stage, prompt);
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
