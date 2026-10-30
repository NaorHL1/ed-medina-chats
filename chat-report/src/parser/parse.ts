import type { DateOrder, Message, ParseResult, Platform } from '../types.js';
import { classifyText, splitSender, stripDirectionMarks } from './normalize.js';

/** WhatsApp on iOS: `[26/10/2026, 20:57:13] Naor: text`, optional seconds and AM/PM. */
const IOS_LINE =
  /^\[(\d{1,2})[./](\d{1,2})[./](\d{2,4}),\s(\d{1,2}):(\d{2})(?::(\d{2}))?(?:[\s ]?([AaPp][Mm]))?\]\s(.*)$/;

/** WhatsApp on Android: `26/10/2026, 20:57 - Naor: text`. */
const ANDROID_LINE =
  /^(\d{1,2})[./](\d{1,2})[./](\d{2,4}),\s(\d{1,2}):(\d{2})(?::(\d{2}))?[\s ]?(?:([AaPp][Mm]))?\s-\s(.*)$/;

/** WhatsApp keeps the newest 40,000 messages in a media-free export; a longer count means truncation is likely. */
const EXPORT_CAP = 40_000;
const TRUNCATION_THRESHOLD = EXPORT_CAP - 1_000;

const PATTERNS: Record<Platform, RegExp> = { ios: IOS_LINE, android: ANDROID_LINE };

export class ChatFormatError extends Error {
  override name = 'ChatFormatError';
}

interface Draft {
  ts: number;
  body: string;
  line: number;
}

export function detectPlatform(lines: string[]): Platform {
  let ios = 0;
  let android = 0;
  for (const raw of lines.slice(0, 50)) {
    const line = stripDirectionMarks(raw);
    if (IOS_LINE.test(line)) ios++;
    if (ANDROID_LINE.test(line)) android++;
  }
  if (ios === 0 && android === 0) {
    throw new ChatFormatError('No WhatsApp timestamp found in the first 50 lines. Export the chat without media and try again.');
  }
  return ios >= android ? 'ios' : 'android';
}

/** Infers day/month order from values above 12. Returns `certain: false` when the file cannot settle it. */
export function inferDateOrder(lines: string[], platform: Platform): { order: DateOrder; certain: boolean } {
  let dayFirst = false;
  let monthFirst = false;
  for (const raw of lines) {
    const match = PATTERNS[platform].exec(stripDirectionMarks(raw));
    if (!match) continue;
    if (Number(match[1]) > 12) dayFirst = true;
    if (Number(match[2]) > 12) monthFirst = true;
  }
  if (dayFirst !== monthFirst) return { order: dayFirst ? 'dmy' : 'mdy', certain: true };
  return { order: 'dmy', certain: false };
}

function toEpochMs(match: RegExpExecArray, order: DateOrder): number | null {
  const first = Number(match[1]);
  const second = Number(match[2]);
  const day = order === 'dmy' ? first : second;
  const month = order === 'dmy' ? second : first;
  const year = Number(match[3]) < 100 ? Number(match[3]) + 2000 : Number(match[3]);
  let hour = Number(match[4]);
  const minute = Number(match[5]);
  const seconds = Number(match[6] ?? 0);
  const meridiem = match[7]?.toLowerCase();

  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem === 'pm' ? 12 : 0);
  }
  return Date.UTC(year, month - 1, day, hour, minute, seconds);
}

function toMessage(draft: Draft, seq: number): Message {
  const { sender, text, edited } = splitSender(draft.body.trim());
  return {
    id: `m${String(seq).padStart(5, '0')}`,
    ts: draft.ts,
    sender,
    text,
    kind: classifyText(text, sender !== null),
    edited,
    line: draft.line,
  };
}

/**
 * Parses a WhatsApp export into messages with stable ids. Lines that do not start
 * a new entry continue the previous message. Lines before the first timestamp are
 * counted as dropped, never silently lost.
 */
export function parseChat(input: string, options: { dateOrder?: DateOrder } = {}): ParseResult {
  const lines = input.split(/\r?\n/);
  const platform = detectPlatform(lines);
  const inferred = inferDateOrder(lines, platform);
  const dateOrder = options.dateOrder ?? inferred.order;

  const warnings: string[] = [];
  if (!options.dateOrder && !inferred.certain) {
    warnings.push(`Day and month order could not be inferred from the file; assumed ${dateOrder}.`);
  }

  const drafts: Draft[] = [];
  let droppedLines = 0;

  lines.forEach((raw, index) => {
    const line = stripDirectionMarks(raw);
    const match = PATTERNS[platform].exec(line);
    const ts = match ? toEpochMs(match, dateOrder) : null;

    if (match && ts !== null) {
      drafts.push({ ts, body: match[8] ?? '', line: index + 1 });
      return;
    }

    const current = drafts.at(-1);
    if (current) {
      current.body += `\n${line}`;
    } else if (line.trim() !== '') {
      droppedLines++;
    }
  });

  const messages = drafts.map((draft, i) => toMessage(draft, i + 1));

  if (messages.length >= TRUNCATION_THRESHOLD) {
    warnings.push(
      `The export holds ${messages.length} messages, close to the ${EXPORT_CAP} the app can export. Earlier history may be missing.`,
    );
  }

  return { platform, dateOrder, messages, droppedLines, warnings };
}
