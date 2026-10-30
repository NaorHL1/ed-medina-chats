import type { Message } from '../types.js';
import {
  buildConversations,
  CONVERSATION_GAP_MS,
  DAY_MS,
  speakingMessages,
  type SpeakingMessage,
  type Turn,
} from './turns.js';
import { emojiOf, isLaughter, isQuestion, isWarm, tokenize, wordPairs } from './text.js';

export interface PhraseStat {
  phrase: string;
  count: number;
  score: number;
}

export interface GhostGap {
  durationMs: number;
  from: number;
  to: number;
  before: string;
  brokeBy: string;
}

export interface PersonMetrics {
  messages: number;
  words: number;
  shareOfMessages: number;
  shareOfWords: number;
  conversationsStarted: number;
  initiationRate: number;
  conversationsEnded: number;
  enderRate: number;
  replyMedianMs: number | null;
  replyP90Ms: number | null;
  turns: number;
  doubleTextRate: number;
  questionsAsked: number;
  questionsAnswered: number;
  questionAnswerRate: number | null;
  medianWordsPerMessage: number | null;
  nightOwlRate: number;
  mediaCount: number;
  audioCount: number;
  laughterCount: number;
  warmthCount: number;
  topEmoji: { emoji: string; count: number }[];
  signaturePhrases: PhraseStat[];
}

export interface ChatMetrics {
  participants: string[];
  totalMessages: number;
  totalWords: number;
  conversations: number;
  span: { start: number; end: number; days: number } | null;
  people: Record<string, PersonMetrics>;
  /** Ratio of the first participant's median reply time to the second's. Null unless exactly two people replied. */
  replyAsymmetry: number | null;
  ghostGaps: GhostGap[];
  longestStreakDays: number;
}

export interface MetricsOptions {
  conversationGapMs?: number;
  /** Phrases need this many uses before they can be called signature. */
  minPhraseCount?: number;
  ghostGapLimit?: number;
  signatureLimit?: number;
  topEmojiLimit?: number;
}

const NIGHT_END_HOUR = 5;

interface Accumulator {
  messages: number;
  words: number;
  wordCounts: number[];
  replyMs: number[];
  turns: number;
  doubledTurns: number;
  questionsAsked: number;
  questionsAnswered: number;
  nightMessages: number;
  mediaCount: number;
  audioCount: number;
  laughterCount: number;
  warmthCount: number;
  emoji: Map<string, number>;
  pairs: Map<string, number>;
  pairTotal: number;
  conversationsStarted: number;
  conversationsEnded: number;
}

function emptyAccumulator(): Accumulator {
  return {
    messages: 0,
    words: 0,
    wordCounts: [],
    replyMs: [],
    turns: 0,
    doubledTurns: 0,
    questionsAsked: 0,
    questionsAnswered: 0,
    nightMessages: 0,
    mediaCount: 0,
    audioCount: 0,
    laughterCount: 0,
    warmthCount: 0,
    emoji: new Map(),
    pairs: new Map(),
    pairTotal: 0,
    conversationsStarted: 0,
    conversationsEnded: 0,
  };
}

/** Nearest-rank percentile for p > 0.5; the mean of the two middle values for the median. Null for an empty sample. */
function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (p === 0.5) {
    const mid = sorted.length / 2;
    return sorted.length % 2 === 1 ? sorted[Math.floor(mid)]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.max(0, rank - 1)] ?? null;
}

function increment<K>(map: Map<K, number>, key: K, by = 1): void {
  map.set(key, (map.get(key) ?? 0) + by);
}

function longestConsecutiveRun(sortedDays: number[]): number {
  let best = 0;
  let run = 0;
  let previous: number | null = null;
  for (const day of sortedDays) {
    run = previous !== null && day === previous + 1 ? run + 1 : 1;
    best = Math.max(best, run);
    previous = day;
  }
  return best;
}

function logOdds(countPerson: number, totalPerson: number, countOthers: number, totalOthers: number): number {
  return Math.log((countPerson + 0.5) / (totalPerson - countPerson + 0.5)) -
    Math.log((countOthers + 0.5) / (totalOthers - countOthers + 0.5));
}

/**
 * Computes every per-person and per-chat number the reports cite. Models interpret
 * these numbers; they never count. Rates are fractions between 0 and 1. Durations are
 * milliseconds. Empty samples produce null, not zero.
 */
export function computeMetrics(messages: Message[], options: MetricsOptions = {}): ChatMetrics {
  const minPhraseCount = options.minPhraseCount ?? 3;
  const ghostGapLimit = options.ghostGapLimit ?? 5;
  const signatureLimit = options.signatureLimit ?? 5;
  const topEmojiLimit = options.topEmojiLimit ?? 3;

  const speaking = speakingMessages(messages);
  const conversations = buildConversations(messages, options.conversationGapMs ?? CONVERSATION_GAP_MS);

  const participants: string[] = [];
  const accumulators = new Map<string, Accumulator>();
  const accumulatorFor = (sender: string): Accumulator => {
    let acc = accumulators.get(sender);
    if (!acc) {
      acc = emptyAccumulator();
      accumulators.set(sender, acc);
      participants.push(sender);
    }
    return acc;
  };

  for (const message of speaking) {
    const acc = accumulatorFor(message.sender);
    acc.messages++;
    if (new Date(message.ts).getUTCHours() < NIGHT_END_HOUR) acc.nightMessages++;
    if (message.kind === 'media') acc.mediaCount++;
    if (message.kind === 'audio') {
      acc.mediaCount++;
      acc.audioCount++;
    }
    if (message.kind !== 'text') continue;

    const wordCount = tokenize(message.text).length;
    acc.words += wordCount;
    acc.wordCounts.push(wordCount);
    if (isLaughter(message.text)) acc.laughterCount++;
    if (isWarm(message.text)) acc.warmthCount++;
    for (const emoji of emojiOf(message.text)) increment(acc.emoji, emoji);
    for (const pair of wordPairs(message.text)) {
      increment(acc.pairs, pair);
      acc.pairTotal++;
    }
  }

  for (const conversation of conversations) {
    const first = conversation.turns[0];
    const last = conversation.turns.at(-1);
    if (first) accumulatorFor(first.sender).conversationsStarted++;
    if (last) accumulatorFor(last.sender).conversationsEnded++;

    conversation.turns.forEach((turn: Turn, k) => {
      const acc = accumulatorFor(turn.sender);
      acc.turns++;
      if (turn.messages.length >= 2) acc.doubledTurns++;

      const previousTurn = conversation.turns[k - 1];
      if (previousTurn) acc.replyMs.push(turn.start - previousTurn.end);

      const hasNextTurn = k + 1 < conversation.turns.length;
      turn.messages.forEach((message, i) => {
        if (message.kind !== 'text' || !isQuestion(message.text)) return;
        acc.questionsAsked++;
        const isLastInTurn = i === turn.messages.length - 1;
        if (isLastInTurn && hasNextTurn) acc.questionsAnswered++;
      });
    });
  }

  const totalMessages = speaking.length;
  const totalWords = [...accumulators.values()].reduce((sum, acc) => sum + acc.words, 0);
  const totalConversations = conversations.length;

  const allPairCounts = new Map<string, number>();
  let allPairTotal = 0;
  for (const acc of accumulators.values()) {
    for (const [pair, count] of acc.pairs) increment(allPairCounts, pair, count);
    allPairTotal += acc.pairTotal;
  }

  const people: Record<string, PersonMetrics> = {};
  for (const person of participants) {
    const acc = accumulators.get(person)!;
    const othersPairTotal = allPairTotal - acc.pairTotal;

    const signaturePhrases: PhraseStat[] = [];
    for (const [phrase, count] of acc.pairs) {
      if (count < minPhraseCount) continue;
      const countOthers = (allPairCounts.get(phrase) ?? 0) - count;
      signaturePhrases.push({
        phrase,
        count,
        score: logOdds(count, acc.pairTotal, countOthers, othersPairTotal),
      });
    }
    signaturePhrases.sort((a, b) => b.score - a.score || b.count - a.count);

    people[person] = {
      messages: acc.messages,
      words: acc.words,
      shareOfMessages: totalMessages === 0 ? 0 : acc.messages / totalMessages,
      shareOfWords: totalWords === 0 ? 0 : acc.words / totalWords,
      conversationsStarted: acc.conversationsStarted,
      initiationRate: totalConversations === 0 ? 0 : acc.conversationsStarted / totalConversations,
      conversationsEnded: acc.conversationsEnded,
      enderRate: totalConversations === 0 ? 0 : acc.conversationsEnded / totalConversations,
      replyMedianMs: percentile(acc.replyMs, 0.5),
      replyP90Ms: percentile(acc.replyMs, 0.9),
      turns: acc.turns,
      doubleTextRate: acc.turns === 0 ? 0 : acc.doubledTurns / acc.turns,
      questionsAsked: acc.questionsAsked,
      questionsAnswered: acc.questionsAnswered,
      questionAnswerRate: acc.questionsAsked === 0 ? null : acc.questionsAnswered / acc.questionsAsked,
      medianWordsPerMessage: percentile(acc.wordCounts, 0.5),
      nightOwlRate: acc.messages === 0 ? 0 : acc.nightMessages / acc.messages,
      mediaCount: acc.mediaCount,
      audioCount: acc.audioCount,
      laughterCount: acc.laughterCount,
      warmthCount: acc.warmthCount,
      topEmoji: [...acc.emoji]
        .sort((a, b) => b[1] - a[1])
        .slice(0, topEmojiLimit)
        .map(([emoji, count]) => ({ emoji, count })),
      signaturePhrases: signaturePhrases.slice(0, signatureLimit),
    };
  }

  const replyAsymmetry = computeReplyAsymmetry(participants, accumulators);
  const ghostGaps = computeGhostGaps(speaking, ghostGapLimit);
  const days = [...new Set(speaking.map((m) => Math.floor(m.ts / DAY_MS)))].sort((a, b) => a - b);
  const first = speaking[0];
  const last = speaking.at(-1);

  return {
    participants,
    totalMessages,
    totalWords,
    conversations: totalConversations,
    span: first && last
      ? { start: first.ts, end: last.ts, days: Math.floor((last.ts - first.ts) / DAY_MS) + 1 }
      : null,
    people,
    replyAsymmetry,
    ghostGaps,
    longestStreakDays: longestConsecutiveRun(days),
  };
}

function computeReplyAsymmetry(participants: string[], accumulators: Map<string, Accumulator>): number | null {
  if (participants.length !== 2) return null;
  const [a, b] = participants.map((p) => percentile(accumulators.get(p)?.replyMs ?? [], 0.5));
  if (a == null || b == null || b === 0) return null;
  return a / b;
}

function computeGhostGaps(speaking: SpeakingMessage[], limit: number): GhostGap[] {
  const gaps: GhostGap[] = [];
  for (let i = 1; i < speaking.length; i++) {
    const before = speaking[i - 1]!;
    const after = speaking[i]!;
    gaps.push({
      durationMs: after.ts - before.ts,
      from: before.ts,
      to: after.ts,
      before: before.sender,
      brokeBy: after.sender,
    });
  }
  return gaps.sort((a, b) => b.durationMs - a.durationMs).slice(0, limit);
}
