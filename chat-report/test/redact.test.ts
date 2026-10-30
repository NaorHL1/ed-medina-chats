import { describe, expect, it } from 'vitest';
import { redactMessages, redactText } from '../src/redact.js';
import type { Message } from '../src/types.js';

describe('redactText', () => {
  it('replaces international and local phone numbers', () => {
    const result = redactText('call +972 50-123-4567 or 050 1234567 now');
    expect(result.text).toBe('call [phone] or [phone] now');
    expect(result.counts.phones).toBe(2);
  });

  it('replaces card-like digit runs before phone matching', () => {
    const result = redactText('card 4111 1111 1111 1111 thanks');
    expect(result.text).toBe('card [number] thanks');
    expect(result.counts).toEqual({ phones: 0, emails: 0, numbers: 1 });
  });

  it('replaces emails', () => {
    expect(redactText('mail me at dana.k+work@example.co.il please').text).toBe('mail me at [email] please');
  });

  it('leaves dates, times and short counts untouched', () => {
    const text = 'on 26/10/2026 at 20:57 we had 1234 messages and 12 voice notes';
    expect(redactText(text).text).toBe(text);
  });

  it('keeps Hebrew text intact around redactions', () => {
    expect(redactText('תתקשר אליי 0501234567 בבקשה').text).toBe('תתקשר אליי [phone] בבקשה');
  });
});

describe('redactMessages', () => {
  const base: Message = { id: 'm00001', ts: 0, sender: 'Naor Haim', text: '', kind: 'text', edited: false, line: 1 };

  it('applies aliases to senders and leaves system lines without a sender', () => {
    const messages: Message[] = [
      { ...base, text: 'hi 0501234567' },
      { ...base, id: 'm00002', sender: null, kind: 'system', text: 'Messages and calls are encrypted' },
    ];
    const result = redactMessages(messages, { 'Naor Haim': 'P1' });

    expect(result.messages[0]).toMatchObject({ sender: 'P1', text: 'hi [phone]' });
    expect(result.messages[1]?.sender).toBeNull();
    expect(result.counts.phones).toBe(1);
  });

  it('does not mutate the input messages', () => {
    const messages = [{ ...base, text: 'x@y.com' }];
    redactMessages(messages);
    expect(messages[0]?.text).toBe('x@y.com');
  });
});
