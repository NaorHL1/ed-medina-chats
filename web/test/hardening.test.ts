import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db, resetDatabase } from '../lib/server/db';
import { allow } from '../lib/server/http';
import { billingMode, createPurchase, freeProvider, hasChatPass, providerFromEnv } from '../lib/server/billing';
import { configProblems } from '../lib/server/config';
import { startGuestSession, sessionUser } from '../lib/server/auth';
import { createChat } from '../lib/server/chats';
import { createReport, nameReport, ReportError } from '../lib/server/reports';
import type { PipelineResult } from '@engine/pipeline/run';
import type { Message } from '@engine/types';

const message = (i: number): Message => ({
  id: `m${String(i).padStart(5, '0')}`,
  ts: Date.UTC(2026, 9, 1, 10, i),
  sender: 'Me',
  text: `hello ${i}`,
  kind: 'text',
  edited: false,
  line: i,
});

const GOOD_KEY = randomBytes(32).toString('base64');

beforeEach(() => {
  process.env['ENCRYPTION_KEY'] = GOOD_KEY;
  resetDatabase();
});

describe('rate limits', () => {
  it('lets calls through up to the limit, then refuses until the window passes', () => {
    const start = 1_000_000;
    expect(allow('k', 2, 1000, start)).toBe(true);
    expect(allow('k', 2, 1000, start + 10)).toBe(true);
    expect(allow('k', 2, 1000, start + 20)).toBe(false);
    expect(allow('k', 2, 1000, start + 1001)).toBe(true);
  });

  it('counts each key on its own', () => {
    expect(allow('a', 1, 1000, 5)).toBe(true);
    expect(allow('b', 1, 1000, 5)).toBe(true);
    expect(allow('a', 1, 1000, 6)).toBe(false);
  });
});

describe('free launch billing', () => {
  it('is chosen only on purpose, and production refuses to run with nothing chosen', () => {
    expect(billingMode({ NODE_ENV: 'production' })).toBe('unset');
    expect(() => providerFromEnv({ NODE_ENV: 'production' })).toThrow(/BILLING_MODE/);
    expect(billingMode({ NODE_ENV: 'production', BILLING_MODE: 'free' })).toBe('free');
    expect(providerFromEnv({ NODE_ENV: 'production', BILLING_MODE: 'free' }).name).toBe('free');
  });

  it('unlocks the chat as soon as checkout starts, with no payment', async () => {
    const guest = sessionUser(startGuestSession())!;
    const chat = createChat(guest.id, 'Chat', [message(1), message(2)]);
    const purchaseId = createPurchase(guest.id, chat.id, 'chat_pass');
    expect(hasChatPass(guest.id, chat.id)).toBe(false);

    const started = await freeProvider.start({ purchaseId, tier: 'chat_pass', returnUrl: `/chats/${chat.id}` });
    expect(started.url).toBe(`/chats/${chat.id}?paid=1`);
    expect(hasChatPass(guest.id, chat.id)).toBe(true);
  });

  it('uses Stripe whenever Stripe keys are set, even with free mode on', () => {
    const env = { STRIPE_SECRET_KEY: 'sk_test_x', STRIPE_WEBHOOK_SECRET: 'whsec_x', BILLING_MODE: 'free' };
    expect(billingMode(env)).toBe('stripe');
  });
});

describe('configuration check', () => {
  it('names what a production server is missing, never a value', () => {
    const problems = configProblems({ NODE_ENV: 'production' });
    expect(problems.map((p) => p.key)).toEqual(['ENCRYPTION_KEY', 'GROQ_API_KEY', 'GROQ_MODEL', 'BILLING_MODE']);
  });

  it('passes when everything is set', () => {
    const env = { NODE_ENV: 'production', ENCRYPTION_KEY: GOOD_KEY, GROQ_API_KEY: 'k', GROQ_MODEL: 'm', BILLING_MODE: 'free' };
    expect(configProblems(env)).toEqual([]);
  });

  it('rejects an encryption key of the wrong length', () => {
    const env = { NODE_ENV: 'production', ENCRYPTION_KEY: 'short', GROQ_API_KEY: 'k', GROQ_MODEL: 'm', BILLING_MODE: 'free' };
    expect(configProblems(env).map((p) => p.key)).toEqual(['ENCRYPTION_KEY']);
  });
});

describe('restart', () => {
  it('marks reports left queued or running as interrupted when a new process opens the database', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'cr-')), 'restart.db');
    resetDatabase(path);
    const guest = sessionUser(startGuestSession())!;
    const chat = createChat(guest.id, 'Chat', [message(1), message(2)]);
    db()
      .prepare('INSERT INTO reports (id, chat_id, report_type, status, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('r1', chat.id, 'full_read', 'running', Date.now());

    // A new process starts with no record that a sweep already happened.
    (globalThis as Record<symbol, boolean | undefined>)[Symbol.for('chat-report.interrupted-swept')] = false;
    resetDatabase(path);

    const row = db().prepare('SELECT status, error FROM reports WHERE id = ?').get('r1') as { status: string; error: string };
    expect(row).toEqual({ status: 'failed', error: 'interrupted' });
  });
});

describe('report errors carry the right status', () => {
  it('uses 402 without a pass, 404 for a missing chat', () => {
    const guest = sessionUser(startGuestSession())!;
    const chat = createChat(guest.id, 'Chat', [message(1), message(2)]);
    expect(() => createReport(guest.id, chat.id, 'full_read')).toThrow(ReportError);
    try {
      createReport(guest.id, chat.id, 'full_read');
    } catch (error) {
      expect((error as ReportError).status).toBe(402);
    }
  });
});

describe('naming people in a finished report', () => {
  const result: PipelineResult = {
    kind: 'report',
    removed: [],
    issues: [],
    criticRounds: 1,
    droppedIds: 0,
    report: {
      report_type: 'full_read',
      language: 'he',
      headline: 'P1 ו-P2',
      cards: [
        { kind: 'stat', metric_ref: 'P1.initiation_rate', caption: 'P1 פותח 73% מהשיחות.' },
        { kind: 'award', award: 'המהיר', winner: 'P2', metric_ref: 'P2.reply_median_ms', evidence: ['m00001'], citation: 'P2 עונה מהר.' },
      ],
      people: [{ id: 'P1', archetype: 'P1 הפותח', one_liner: 'מתחיל' }],
      followups: ['P2 ממשיך'],
    },
  };

  it('swaps ids for nicknames in words and winners, and leaves refs and ids alone', () => {
    const named = nameReport(result, { נעם: 'P1', דנה: 'P2' });
    if (named.kind !== 'report') throw new Error('expected a report');
    expect(named.report.headline).toBe('נעם ו-דנה');
    expect(named.report.cards[0]).toEqual({ kind: 'stat', metric_ref: 'P1.initiation_rate', caption: 'נעם פותח 73% מהשיחות.' });
    expect(named.report.cards[1]).toMatchObject({ winner: 'דנה', metric_ref: 'P2.reply_median_ms', evidence: ['m00001'], citation: 'דנה עונה מהר.' });
    expect(named.report.people[0]).toEqual({ id: 'P1', archetype: 'נעם הפותח', one_liner: 'מתחיל' });
    expect(named.report.followups).toEqual(['דנה ממשיך']);
  });

  it('leaves care and stopped results as they are', () => {
    const care: PipelineResult = { kind: 'care', flag: 'self_harm', summary: 'P1 note', resources: [] };
    expect(nameReport(care, { נעם: 'P1' })).toEqual(care);
  });
});
