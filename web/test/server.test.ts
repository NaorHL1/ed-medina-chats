import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes, createHmac } from 'node:crypto';
import { resetDatabase } from '../lib/server/db';
import { open, seal, tokenHash } from '../lib/server/crypto';
import { consumeLogin, requestLogin, safeNext, sessionUser } from '../lib/server/auth';
import { createChat, deleteAllData, getChat, listChats, MAX_MESSAGES } from '../lib/server/chats';
import { CATALOG, createPurchase, hasChatPass, markPaid, stubProvider, verifyStripeSignature } from '../lib/server/billing';
import { createReport, drainQueue, getReport, ReportError } from '../lib/server/reports';
import { db } from '../lib/server/db';
import type { Message } from '@engine/types';
import type { ModelClient } from '@engine/pipeline/run';

const KEY = randomBytes(32).toString('base64');
const message = (i: number, sender = 'Me'): Message => ({
  id: `m${String(i).padStart(5, '0')}`,
  ts: Date.UTC(2026, 9, 1, 10, i),
  sender,
  text: `hello ${i}`,
  kind: 'text',
  edited: false,
  line: i,
});

beforeEach(() => {
  process.env['ENCRYPTION_KEY'] = KEY;
  delete process.env['GROQ_API_KEY'];
  delete process.env['GROQ_MODEL'];
  resetDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The login link inside the dev console line, which reads '[dev login] <email>: <link>'. */
function tokenFrom(line: string): URL {
  return new URL(line.slice(line.indexOf('http')));
}

/** Signs a user in through the real magic-link path and returns the session token. */
async function signIn(email: string): Promise<string> {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  expect(await requestLogin(email, true, 'http://localhost')).toBe('sent');
  const link = String(log.mock.calls.at(-1)?.[0]);
  const token = tokenFrom(link).searchParams.get('token')!;
  const session = consumeLogin(token);
  expect(session).not.toBeNull();
  return session!;
}

describe('crypto', () => {
  it('round-trips a payload and rejects tampering', () => {
    const sealed = seal('secret chat');
    expect(open(sealed)).toBe('secret chat');
    const [iv, tag, body] = sealed.split('.');
    const flipped = Buffer.from(body!, 'base64');
    flipped[0] = flipped[0]! ^ 1;
    expect(() => open([iv, tag, flipped.toString('base64')].join('.'))).toThrow();
  });

  it('stores session tokens only as hashes', () => {
    expect(tokenHash('abc')).not.toContain('abc');
    expect(tokenHash('abc')).toHaveLength(64);
  });

  it('refuses a key that is not 32 bytes', () => {
    process.env['ENCRYPTION_KEY'] = Buffer.from('short').toString('base64');
    expect(() => seal('x')).toThrow(/32 bytes/);
  });
});

describe('auth', () => {
  it('needs the 18+ confirmation', async () => {
    expect(await requestLogin('a@example.com', false, 'http://localhost')).toBe('age_required');
  });

  it('rejects an invalid address', async () => {
    expect(await requestLogin('not-an-email', true, 'http://localhost')).toBe('invalid_email');
  });

  it('signs in once; the same link cannot be used twice', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await requestLogin('Dana@Example.com', true, 'http://localhost');
    const token = new URL(String(log.mock.calls[0]![0]).replace(/^\[dev login\][^h]*/, '')).searchParams.get('token')!;
    const session = consumeLogin(token);
    expect(session).not.toBeNull();
    expect(consumeLogin(token)).toBeNull();
    expect(sessionUser(session!)?.email).toBe('dana@example.com');
  });

  it('expires a login link after its time is up', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await requestLogin('a@example.com', true, 'http://localhost');
    const token = new URL(String(log.mock.calls[0]![0]).replace(/^\[dev login\][^h]*/, '')).searchParams.get('token')!;
    db().prepare('UPDATE login_links SET expires_at = 0').run();
    expect(consumeLogin(token)).toBeNull();
  });

  it('only follows same-site paths after sign-in', () => {
    expect(safeNext('/?resume=1')).toBe('/?resume=1');
    expect(safeNext('https://evil.example')).toBe('/chats');
    expect(safeNext('//evil.example')).toBe('/chats');
  });
});

describe('chats', () => {
  it('stores messages encrypted and returns them to the owner only', async () => {
    const owner = await signIn('owner@example.com');
    const other = await signIn('other@example.com');
    const ownerId = sessionUser(owner)!.id;
    const otherId = sessionUser(other)!.id;

    const chat = createChat(ownerId, 'Friends', [message(1), message(2)]);
    const raw = db().prepare('SELECT payload FROM chats WHERE id = ?').get(chat.id) as { payload: string };
    expect(raw.payload).not.toContain('hello 1');

    expect(getChat(ownerId, chat.id)?.messages).toHaveLength(2);
    expect(getChat(otherId, chat.id)).toBeNull();
    expect(listChats(ownerId)).toHaveLength(1);
  });

  it('refuses empty and oversized uploads', () => {
    const user = sessionUser(undefined);
    expect(user).toBeNull();
    expect(() => createChat('u', 'x', [])).toThrow(/no messages/);
    const big = Array.from({ length: MAX_MESSAGES + 1 }, (_, i) => message(i));
    expect(() => createChat('u', 'x', big)).toThrow(/40000|More than/);
  });

  it('deletes every chat, report and session for the user', async () => {
    const session = await signIn('gone@example.com');
    const userId = sessionUser(session)!.id;
    createChat(userId, 'One', [message(1)]);
    deleteAllData(userId);
    expect(listChats(userId)).toHaveLength(0);
    expect(sessionUser(session)).toBeNull();
  });
});

describe('billing', () => {
  it('unlocks a chat only after the purchase is marked paid, and only once', async () => {
    const session = await signIn('buyer@example.com');
    const userId = sessionUser(session)!.id;
    const chat = createChat(userId, 'Chat', [message(1)]);

    const purchaseId = createPurchase(userId, chat.id, 'chat_pass');
    expect(hasChatPass(userId, chat.id)).toBe(false);
    expect(markPaid(purchaseId, 'ref')).toBe(true);
    expect(markPaid(purchaseId, 'ref')).toBe(false);
    expect(hasChatPass(userId, chat.id)).toBe(true);
  });

  it('the stub provider starts checkout with no payment', async () => {
    const started = await stubProvider.start({ purchaseId: 'p1', tier: 'chat_pass', returnUrl: 'http://x/chats/1' });
    expect(started.url).toBe('/api/billing/stub/complete?purchase=p1');
    expect(CATALOG.chat_pass.amountCents).toBe(999);
  });

  it('verifies Stripe webhook signatures and rejects stale or forged ones', () => {
    const secret = 'whsec_test';
    const body = JSON.stringify({ type: 'checkout.session.completed' });
    const now = Date.now();
    const sign = (t: number, payload: string) =>
      `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;

    expect(verifyStripeSignature(body, sign(Math.floor(now / 1000), body), secret, now)).toBe(true);
    expect(verifyStripeSignature(body, sign(Math.floor(now / 1000), 'other'), secret, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(Math.floor(now / 1000) - 3600, body), secret, now)).toBe(false);
    expect(verifyStripeSignature(body, null, secret, now)).toBe(false);
  });
});

describe('reports', () => {
  it('will not start a report without a Chat Pass', async () => {
    const session = await signIn('free@example.com');
    const userId = sessionUser(session)!.id;
    const chat = createChat(userId, 'Chat', [message(1)]);
    expect(() => createReport(userId, chat.id, 'full_read')).toThrow(ReportError);
  });

  it('records a failed job with a clear message when the model is not configured', async () => {
    const session = await signIn('reader@example.com');
    const userId = sessionUser(session)!.id;
    const chat = createChat(userId, 'Chat', [message(1)]);
    markPaid(createPurchase(userId, chat.id, 'chat_pass'), 'ref');

    const queued = createReport(userId, chat.id, 'full_read');
    await drainQueue();
    const finished = getReport(userId, queued.id);
    expect(finished?.status).toBe('failed');
    expect(finished?.error).toMatch(/GROQ_API_KEY/);
    // A failed job keeps the transcript, so the user can retry.
    expect(getChat(userId, chat.id)?.messages).not.toBeNull();
  });

  it('deletes the transcript once the report finishes, and refuses a new report after', async () => {
    const session = await signIn('care@example.com');
    const userId = sessionUser(session)!.id;
    const chat = createChat(userId, 'Chat', [message(1), message(2)]);
    markPaid(createPurchase(userId, chat.id, 'chat_pass'), 'ref');
    const client: ModelClient = {
      complete: async (stage) =>
        stage === 'extractor'
          ? JSON.stringify({ moments: [], care_flags: [{ type: 'self_harm', ids: [], severity: 'high' }] })
          : JSON.stringify({ summary: 'A calm note.', resources: ['ERAN'] }),
    };

    const report = createReport(userId, chat.id, 'full_read', { client });
    await drainQueue();
    expect(getReport(userId, report.id)?.status).toBe('care');
    expect(getChat(userId, chat.id)?.messages).toBeNull();
    expect(listChats(userId)[0]?.hasTranscript).toBe(false);
    expect(() => createReport(userId, chat.id, 'full_read', { client })).toThrow(/transcript was deleted/);
  });

  it('fails a report the checks left nearly empty, and keeps the chat so it can be retried', async () => {
    const session = await signIn('thin@example.com');
    const userId = sessionUser(session)!.id;
    const chat = createChat(userId, 'Chat', [message(1), message(2)]);
    markPaid(createPurchase(userId, chat.id, 'chat_pass'), 'ref');
    const thin = { report_type: 'full_read', language: 'en', headline: 'Thin', cards: [{ kind: 'chart', chart: 'x' }], people: [], followups: [] };
    const client: ModelClient = {
      complete: async (stage) =>
        stage === 'extractor' ? JSON.stringify({ moments: [], care_flags: [] }) : stage === 'writer' ? JSON.stringify(thin) : '[]',
    };

    const report = createReport(userId, chat.id, 'full_read', { client });
    await drainQueue();
    const stored = getReport(userId, report.id);
    expect(stored?.status).toBe('failed');
    expect(stored?.error).toBe('not_enough_cards');
    expect(getChat(userId, chat.id)?.messages).not.toBeNull();
  });

  it('hides another user’s report', async () => {
    const owner = sessionUser(await signIn('a@example.com'))!.id;
    const other = sessionUser(await signIn('b@example.com'))!.id;
    const chat = createChat(owner, 'Chat', [message(1)]);
    markPaid(createPurchase(owner, chat.id, 'chat_pass'), 'ref');
    const report = createReport(owner, chat.id, 'full_read');
    await drainQueue();
    expect(getReport(other, report.id)).toBeNull();
  });
});
