import { describe, expect, it } from 'vitest';
import { ChatFormatError, detectPlatform, inferDateOrder, parseChat } from '../src/parser/parse.js';

const IOS = [
  '‎[26/10/2026, 20:57:13] ‎Messages and calls are end-to-end encrypted. No one outside of this chat can read them.',
  '[26/10/2026, 20:58:01] Naor: היי מה נשמע',
  '[26/10/2026, 20:59:44] Dana: בסדר גמור',
  '[26/10/2026, 21:00:00] Dana: first line of a long message',
  'second line, no timestamp',
  '[26/10/2026, 21:01:10] Naor: <Media omitted>',
  '[26/10/2026, 21:02:00] Dana: ‎<attached: 00000012-PTT-2026-10-26-AUDIO-1.opus>',
  '[26/10/2026, 21:03:00] Naor: This message was deleted.',
  '[26/10/2026, 21:04:00] Dana: fixed it <This message was edited>',
].join('\n');

const ANDROID = [
  '26/10/2026, 8:58 PM - Naor: hey',
  '26/10/2026, 8:59 PM - Dana: hi there',
  '26/10/2026, 9:30 PM - Dana: <Media omitted>',
  '27/10/2026, 12:01 AM - Naor: late night',
  '27/10/2026, 12:05 PM - Messages and calls are end-to-end encrypted.',
].join('\r\n');

describe('detectPlatform', () => {
  it('locks iOS and Android formats from the first lines', () => {
    expect(detectPlatform(IOS.split('\n'))).toBe('ios');
    expect(detectPlatform(ANDROID.split('\r\n'))).toBe('android');
  });

  it('rejects text with no WhatsApp timestamps', () => {
    expect(() => detectPlatform(['just some notes', 'nothing dated here'])).toThrow(ChatFormatError);
  });
});

describe('inferDateOrder', () => {
  it('reads day-first when a first value exceeds 12', () => {
    expect(inferDateOrder(['26/10/2026, 20:57 - A: x'], 'android')).toEqual({ order: 'dmy', certain: true });
  });

  it('reads month-first when a second value exceeds 12', () => {
    expect(inferDateOrder(['10/26/2026, 20:57 - A: x'], 'android')).toEqual({ order: 'mdy', certain: true });
  });

  it('flags ambiguous files and defaults to day-first', () => {
    expect(inferDateOrder(['03/04/2026, 20:57 - A: x'], 'android')).toEqual({ order: 'dmy', certain: false });
  });
});

describe('parseChat', () => {
  it('parses iOS exports with ids, senders, kinds and multi-line bodies', () => {
    const result = parseChat(IOS);

    expect(result.platform).toBe('ios');
    expect(result.droppedLines).toBe(0);
    expect(result.messages.map((m) => m.id)).toEqual(['m00001', 'm00002', 'm00003', 'm00004', 'm00005', 'm00006', 'm00007', 'm00008']);

    const [system, hebrew, , multiline, media, audio, deleted, edited] = result.messages;
    expect(system).toMatchObject({ sender: null, kind: 'system' });
    expect(hebrew).toMatchObject({ sender: 'Naor', text: 'היי מה נשמע', kind: 'text' });
    expect(multiline?.text).toBe('first line of a long message\nsecond line, no timestamp');
    expect(media).toMatchObject({ sender: 'Naor', kind: 'media' });
    expect(audio?.kind).toBe('audio');
    expect(deleted?.kind).toBe('deleted');
    expect(edited).toMatchObject({ text: 'fixed it', edited: true });
  });

  it('parses Android 12-hour exports with narrow no-break spaces and AM/PM', () => {
    const withNbsp = ANDROID.replace('8:58 PM', '8:58 PM');
    const result = parseChat(withNbsp);

    expect(result.platform).toBe('android');
    expect(result.messages[0]?.ts).toBe(Date.UTC(2026, 9, 26, 20, 58));
    expect(result.messages.at(-2)?.ts).toBe(Date.UTC(2026, 9, 27, 0, 1));
    expect(result.messages.at(-1)).toMatchObject({ kind: 'system', sender: null });
  });

  it('keeps timestamps in UTC so day arithmetic ignores the machine timezone', () => {
    const result = parseChat(IOS);
    expect(result.messages[1]?.ts).toBe(Date.UTC(2026, 9, 26, 20, 58, 1));
  });

  it('counts lines before the first message as dropped, not blank lines', () => {
    const result = parseChat(`orphan line\n\n${ANDROID}`);
    expect(result.droppedLines).toBe(1);
  });

  it('warns when the file is close to WhatsApp’s export cap', () => {
    const big = Array.from({ length: 39_500 }, (_, i) => `1/1/2026, 10:00 - A: msg ${i}`).join('\n');
    expect(parseChat(big).warnings.join(' ')).toMatch(/Earlier history may be missing/);
  });

  it('warns and assumes day-first when the order is ambiguous', () => {
    const result = parseChat('03/04/2026, 20:57 - A: x\n04/05/2026, 20:58 - B: y');
    expect(result.dateOrder).toBe('dmy');
    expect(result.warnings).toHaveLength(1);
  });

  it('respects an explicit date order over inference', () => {
    const result = parseChat('03/04/2026, 20:57 - A: x', { dateOrder: 'mdy' });
    expect(result.messages[0]?.ts).toBe(Date.UTC(2026, 2, 4, 20, 57));
    expect(result.warnings).toEqual([]);
  });
});
