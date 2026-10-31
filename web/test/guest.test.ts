import { beforeEach, describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { resetDatabase } from '../lib/server/db';
import { sessionUser, startGuestSession } from '../lib/server/auth';
import { createChat, getChat } from '../lib/server/chats';
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

beforeEach(() => {
  process.env['ENCRYPTION_KEY'] = randomBytes(32).toString('base64');
  resetDatabase();
});

describe('guest sessions', () => {
  it('gives a session with no email', () => {
    const token = startGuestSession();
    const user = sessionUser(token);
    expect(user).not.toBeNull();
    expect(user?.email).toBeNull();
  });

  it('keeps a separate guest for each browser', () => {
    const first = sessionUser(startGuestSession());
    const second = sessionUser(startGuestSession());
    expect(first?.id).not.toBe(second?.id);
  });

  it('lets a guest save a chat that only that guest can read', () => {
    const guest = sessionUser(startGuestSession())!;
    const other = sessionUser(startGuestSession())!;
    const chat = createChat(guest.id, 'Guest chat', [message(1), message(2)]);
    expect(getChat(guest.id, chat.id)?.messages).toHaveLength(2);
    expect(getChat(other.id, chat.id)).toBeNull();
  });
});
