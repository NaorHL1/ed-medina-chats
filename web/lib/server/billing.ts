import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { db } from './db';

/** MVP catalogue. Chat Pass unlocks every paid report for one chat; single reports come later. */
export const CATALOG = {
  chat_pass: { label: 'Chat Pass', amountCents: 999, currency: 'usd' },
} as const;
export type Tier = keyof typeof CATALOG;

export interface CheckoutStart {
  url: string;
  providerRef: string;
}

/** The only payment seam. The stub and Stripe implement it; nothing else talks to a payment provider. */
export interface CheckoutProvider {
  name: 'stub' | 'stripe' | 'free';
  start(input: { purchaseId: string; tier: Tier; returnUrl: string }): Promise<CheckoutStart>;
  /** Returns the purchase id that was paid, or null when the event is not a completed payment. */
  parseWebhook(body: string, signature: string | null): string | null;
}

export function createPurchase(userId: string, chatId: string, tier: Tier): string {
  const id = randomUUID();
  db()
    .prepare('INSERT INTO purchases (id, user_id, chat_id, tier, status, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, userId, chatId, tier, 'pending', Date.now());
  return id;
}

/** Marks a purchase paid once. Repeat webhooks for the same purchase change nothing. */
export function markPaid(purchaseId: string, providerRef: string | null): boolean {
  const result = db()
    .prepare(`UPDATE purchases SET status = 'paid', provider_ref = COALESCE(?, provider_ref) WHERE id = ? AND status = 'pending'`)
    .run(providerRef, purchaseId);
  return Number(result.changes) === 1;
}

/** True when the chat has a paid Chat Pass. */
export function hasChatPass(userId: string, chatId: string): boolean {
  const row = db()
    .prepare(`SELECT 1 FROM purchases WHERE user_id = ? AND chat_id = ? AND tier = 'chat_pass' AND status = 'paid' LIMIT 1`)
    .get(userId, chatId);
  return row !== undefined;
}

/** Dev-only: completes checkout without money. Refuses to run in production. */
export const stubProvider: CheckoutProvider = {
  name: 'stub',
  async start({ purchaseId }) {
    return { url: `/api/billing/stub/complete?purchase=${purchaseId}`, providerRef: `stub_${purchaseId}` };
  },
  parseWebhook() {
    return null;
  },
};

/**
 * Launch mode with no payment: the purchase is marked paid on the spot. It must be chosen on purpose
 * with BILLING_MODE=free, so production never gives the full read away by accident.
 */
export const freeProvider: CheckoutProvider = {
  name: 'free',
  async start({ purchaseId, returnUrl }) {
    markPaid(purchaseId, `free_${purchaseId}`);
    return { url: `${returnUrl}?paid=1`, providerRef: `free_${purchaseId}` };
  },
  parseWebhook() {
    return null;
  },
};

/** Stripe Checkout in test or live mode, chosen by the key. Calls the REST API directly, with no SDK. */
export function stripeProvider(secretKey: string, webhookSecret: string, fetchImpl: typeof fetch = fetch): CheckoutProvider {
  return {
    name: 'stripe',
    async start({ purchaseId, tier, returnUrl }) {
      const item = CATALOG[tier];
      const form = new URLSearchParams({
        mode: 'payment',
        client_reference_id: purchaseId,
        success_url: `${returnUrl}?paid=1`,
        cancel_url: `${returnUrl}?paid=0`,
        'line_items[0][quantity]': '1',
        'line_items[0][price_data][currency]': item.currency,
        'line_items[0][price_data][unit_amount]': String(item.amountCents),
        'line_items[0][price_data][product_data][name]': item.label,
      });
      const response = await fetchImpl('https://api.stripe.com/v1/checkout/sessions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      });
      if (!response.ok) throw new Error(`Stripe checkout failed with HTTP ${response.status}`);
      const session = (await response.json()) as { id: string; url: string };
      return { url: session.url, providerRef: session.id };
    },
    parseWebhook(body, signature) {
      if (!verifyStripeSignature(body, signature, webhookSecret)) return null;
      const event = JSON.parse(body) as { type: string; data: { object: { client_reference_id?: string; id: string; payment_status?: string } } };
      if (event.type !== 'checkout.session.completed' || event.data.object.payment_status !== 'paid') return null;
      return event.data.object.client_reference_id ?? null;
    },
  };
}

/** Checks Stripe's `Stripe-Signature` header (t=…,v1=…) with a 5-minute tolerance. */
export function verifyStripeSignature(body: string, header: string | null, secret: string, now = Date.now()): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(',').map((kv) => kv.split('=') as [string, string]));
  const timestamp = Number(parts['t']);
  const signature = parts['v1'];
  if (!Number.isFinite(timestamp) || !signature) return false;
  if (Math.abs(now / 1000 - timestamp) > 300) return false;
  const expected = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** How checkout runs, without creating a provider. Safe to call from a config route. */
export function billingMode(env: Record<string, string | undefined> = process.env): 'stripe' | 'free' | 'stub' | 'unset' {
  if (env['STRIPE_SECRET_KEY'] && env['STRIPE_WEBHOOK_SECRET']) return 'stripe';
  if (env['BILLING_MODE'] === 'free') return 'free';
  return env['NODE_ENV'] === 'production' ? 'unset' : 'stub';
}

/** Picks Stripe when keys are set, free launch mode when asked for, otherwise the stub. Production refuses the stub. */
export function providerFromEnv(env: Record<string, string | undefined> = process.env): CheckoutProvider {
  const mode = billingMode(env);
  if (mode === 'stripe') return stripeProvider(env['STRIPE_SECRET_KEY']!, env['STRIPE_WEBHOOK_SECRET']!);
  if (mode === 'free') return freeProvider;
  if (mode === 'unset') throw new Error('Set BILLING_MODE=free, or STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET, in production.');
  return stubProvider;
}
