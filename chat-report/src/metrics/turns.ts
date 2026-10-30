import type { Message } from '../types.js';

export const HOUR_MS = 3_600_000;
export const DAY_MS = 24 * HOUR_MS;

/** Silence that ends a conversation. Matches the 6-hour default in the product plan. */
export const CONVERSATION_GAP_MS = 6 * HOUR_MS;

/** A run of consecutive messages from one sender, inside one conversation. */
export interface Turn {
  sender: string;
  conversation: number;
  messages: Message[];
  start: number;
  end: number;
}

export interface Conversation {
  index: number;
  start: number;
  end: number;
  turns: Turn[];
}

/** A message with a real sender. System lines never count toward any metric. */
export type SpeakingMessage = Message & { sender: string };

export function speakingMessages(messages: Message[]): SpeakingMessage[] {
  return messages.filter((m): m is SpeakingMessage => m.sender !== null);
}

export function buildConversations(messages: Message[], gapMs = CONVERSATION_GAP_MS): Conversation[] {
  const conversations: Conversation[] = [];
  let previous: Message | null = null;

  for (const message of speakingMessages(messages)) {
    const startsConversation = previous === null || message.ts - previous.ts > gapMs;
    if (startsConversation) {
      conversations.push({ index: conversations.length, start: message.ts, end: message.ts, turns: [] });
    }
    const conversation = conversations[conversations.length - 1]!;
    const lastTurn = conversation.turns.at(-1);
    const continuesTurn = !startsConversation && lastTurn !== undefined && lastTurn.sender === message.sender;

    if (continuesTurn) {
      lastTurn.messages.push(message);
      lastTurn.end = message.ts;
    } else {
      conversation.turns.push({
        sender: message.sender,
        conversation: conversation.index,
        messages: [message],
        start: message.ts,
        end: message.ts,
      });
    }
    conversation.end = message.ts;
    previous = message;
  }

  return conversations;
}
