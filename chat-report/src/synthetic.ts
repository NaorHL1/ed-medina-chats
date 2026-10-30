import { DAY_MS, HOUR_MS } from './metrics/turns.js';
import type { DateOrder, Message, MessageKind, Platform } from './types.js';

const MINUTE_MS = 60_000;
const SECOND_MS = 1_000;

const SYSTEM_OPENER = 'Messages and calls are end-to-end encrypted. No one outside of this chat can read them.';

const LINES: Record<'en' | 'he', string[]> = {
  en: ['ok', 'on my way', 'lol', 'what time?', 'sounds good', 'call me later', 'did you see that', 'haha yes',
    'no way', 'i will be there in 10', 'where are you?', 'nice', 'tomorrow?', 'thanks!'],
  he: ['אוקיי', 'בדרך', 'חחח', 'מה השעה?', 'נשמע טוב', 'נדבר אחר כך', 'ראית את זה?', 'לא ייאמן', 'מחר?',
    'תודה!', 'איפה אתה?', 'יופי'],
};

const FIGHT_LINES: Record<'en' | 'he', string[]> = {
  en: ['you never listen', 'that is not what i said', 'whatever', 'fine', 'why do you always do this?'],
  he: ['אתה אף פעם לא מקשיב', 'זה לא מה שאמרתי', 'נו טוב', 'בסדר', 'למה אתה תמיד ככה?'],
};

export interface SyntheticSpec {
  seed: number;
  /** First day of the chat, UTC, as YYYY-MM-DD. */
  startDate: string;
  days: number;
  /** Two or more names. In a two-person chat, people[0] opens conversations with `firstPersonOpenRate`. */
  people: string[];
  /** Mean conversations per day. Keep at 2 or below so conversations stay separated by 6 hours. */
  conversationsPerDay: number;
  firstPersonOpenRate: number;
  language: 'en' | 'he';
  /** A phrase people[0] reuses often. The generator counts how often it plants it. */
  insideJoke?: string;
  /** Day index with an argument: an extra conversation of fight lines. */
  fightDay?: number;
  /** From this day on, people[1] replies after 20 to 60 minutes instead of 1 to 5. */
  slowReplyFromDay?: number;
  /** From this day on, conversations drop to 0.3 per day. */
  quietFromDay?: number;
  /** Chance of a voice note or media placeholder per message. */
  mediaRate?: number;
}

export interface SyntheticTruth {
  firstPersonOpenRate: number;
  insideJokeCount: number;
  fightDay: number | null;
  slowReplyFromDay: number | null;
  quietFromDay: number | null;
}

export interface SyntheticChat {
  messages: Message[];
  truth: SyntheticTruth;
}

/** Small, fast, deterministic PRNG (mulberry32). Same seed, same chat. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateChat(spec: SyntheticSpec): SyntheticChat {
  if (spec.people.length < 2) throw new Error('A synthetic chat needs at least two people.');
  if (spec.conversationsPerDay > 2) throw new Error('conversationsPerDay above 2 would merge conversations.');

  const rand = mulberry32(spec.seed);
  const pick = <T>(items: T[]): T => items[Math.floor(rand() * items.length)]!;
  const lines = LINES[spec.language];
  const fightLines = FIGHT_LINES[spec.language];
  const [first, second] = spec.people as [string, string];
  const dayZero = Date.parse(`${spec.startDate}T00:00:00Z`);
  const mediaRate = spec.mediaRate ?? 0.03;

  const planted: Message[] = [];
  let insideJokeCount = 0;

  // Whole minutes only, so both the iOS (seconds) and Android (minutes) formats round-trip exactly.
  const emit = (ts: number, sender: string, text: string, kind: MessageKind = 'text') => {
    const wholeMinute = Math.floor(ts / MINUTE_MS) * MINUTE_MS;
    planted.push({ id: '', ts: wholeMinute, sender, text, kind, edited: false, line: 0 });
  };

  const sayFor = (sender: string): { text: string; kind: MessageKind } => {
    const roll = rand();
    if (roll < mediaRate) return { text: '<Media omitted>', kind: 'media' };
    if (roll < mediaRate * 1.5) return { text: 'audio omitted', kind: 'audio' };
    if (spec.insideJoke && sender === first && rand() < 0.15) {
      insideJokeCount++;
      return { text: spec.insideJoke, kind: 'text' };
    }
    const base = pick(lines);
    const text = rand() < 0.25 ? `${base}?` : base;
    return { text, kind: 'text' };
  };

  const conversation = (start: number, opener: string, length: number, slowReplies: boolean, script: string[] | null) => {
    let t = start;
    let current = opener;
    let sent = 0;
    while (sent < length) {
      const line = script ? { text: pick(script), kind: 'text' as const } : sayFor(current);
      emit(t, current, line.text, line.kind);
      sent++;
      if (sent < length && rand() < 0.2) {
        t += (20 + rand() * 70) * SECOND_MS;
        emit(t, current, pick(script ?? lines), 'text');
        sent++;
      }
      const other = current === first ? second : first;
      const slow = slowReplies && other === second;
      t += (slow ? 20 + rand() * 40 : 1 + rand() * 4) * MINUTE_MS;
      current = other;
    }
  };

  for (let day = 0; day < spec.days; day++) {
    const dayStart = dayZero + day * DAY_MS;
    const quiet = spec.quietFromDay !== undefined && day >= spec.quietFromDay;
    const rate = quiet ? 0.3 : spec.conversationsPerDay;
    const count = Math.floor(rate) + (rand() < rate % 1 ? 1 : 0);
    const slowReplies = spec.slowReplyFromDay !== undefined && day >= spec.slowReplyFromDay;

    for (let slot = 0; slot < count; slot++) {
      const slotStart = dayStart + (8 * HOUR_MS) + (slot * 7 * HOUR_MS) + rand() * HOUR_MS;
      const opener = spec.people.length === 2
        ? (rand() < spec.firstPersonOpenRate ? first : second)
        : pick(spec.people);
      conversation(slotStart, opener, 3 + Math.floor(rand() * 6), slowReplies, null);
    }

    if (spec.fightDay === day) {
      const fightStart = dayStart + 22 * HOUR_MS;
      conversation(fightStart, second, 10, false, fightLines);
    }
  }

  planted.sort((a, b) => a.ts - b.ts);
  const messages: Message[] = [
    { id: '', ts: planted[0]?.ts ?? dayZero, sender: null, text: SYSTEM_OPENER, kind: 'system', edited: false, line: 0 },
    ...planted,
  ];
  messages.forEach((m, i) => {
    m.id = `m${String(i + 1).padStart(5, '0')}`;
    m.line = i + 1;
  });

  return {
    messages,
    truth: {
      firstPersonOpenRate: spec.firstPersonOpenRate,
      insideJokeCount,
      fightDay: spec.fightDay ?? null,
      slowReplyFromDay: spec.slowReplyFromDay ?? null,
      quietFromDay: spec.quietFromDay ?? null,
    },
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Writes messages as a WhatsApp export the parser must read back. Android can use
 * 12-hour time with a narrow no-break space before AM/PM, as recent builds do.
 */
export function formatChat(
  messages: Message[],
  options: { platform: Platform; dateOrder?: DateOrder; android12h?: boolean },
): string {
  const order = options.dateOrder ?? 'dmy';
  return messages
    .map((m) => {
      const d = new Date(m.ts);
      const day = pad(d.getUTCDate());
      const month = pad(d.getUTCMonth() + 1);
      const year = String(d.getUTCFullYear());
      const date = order === 'dmy' ? `${day}/${month}/${year}` : `${month}/${day}/${year}`;
      const hours = d.getUTCHours();
      const minutes = pad(d.getUTCMinutes());
      const seconds = pad(d.getUTCSeconds());
      const body = m.sender === null ? m.text : `${m.sender}: ${m.text}`;

      if (options.platform === 'ios') {
        return `[${date}, ${pad(hours)}:${minutes}:${seconds}] ${body}`;
      }
      if (options.android12h) {
        const meridiem = hours >= 12 ? 'PM' : 'AM';
        const hour12 = hours % 12 === 0 ? 12 : hours % 12;
        return `${date}, ${hour12}:${minutes} ${meridiem} - ${body}`;
      }
      return `${date}, ${pad(hours)}:${minutes} - ${body}`;
    })
    .join('\n');
}
