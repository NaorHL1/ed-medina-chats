import type { Message } from './types.js';

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** A digit run with at most one separator between digits, optionally led by "+". */
const DIGIT_RUN = /\+?\d(?:[\s\-(). ]?\d){7,}/g;

const CARD_MIN_DIGITS = 13;
const CARD_MAX_DIGITS = 19;
const PHONE_MIN_DIGITS = 9;
const PHONE_MAX_DIGITS = 12;

export interface RedactionCounts {
  phones: number;
  emails: number;
  numbers: number;
}

export interface RedactionResult {
  text: string;
  counts: RedactionCounts;
}

/**
 * Replaces emails, card-like digit runs and phone-like digit runs with placeholders.
 * Runs of 13 to 19 digits count as card-like; runs of 9 to 12 digits count as phones.
 * Shorter numbers (dates, times, counts) are left alone.
 */
export function redactText(text: string): RedactionResult {
  const counts: RedactionCounts = { phones: 0, emails: 0, numbers: 0 };

  const withoutEmails = text.replace(EMAIL, () => {
    counts.emails++;
    return '[email]';
  });

  const redacted = withoutEmails.replace(DIGIT_RUN, (run) => {
    const digits = run.replace(/\D/g, '').length;
    if (digits >= CARD_MIN_DIGITS && digits <= CARD_MAX_DIGITS) {
      counts.numbers++;
      return '[number]';
    }
    if (digits >= PHONE_MIN_DIGITS && digits <= PHONE_MAX_DIGITS) {
      counts.phones++;
      return '[phone]';
    }
    return run;
  });

  return { text: redacted, counts };
}

/**
 * Prepares messages for anything that leaves the browser. Each real sender name
 * becomes its alias (when one is set) and every number or email in the text is
 * redacted. Names that appear inside message bodies are not rewritten here; the
 * who-is-who screen asks the uploader to alias them too.
 */
export function redactMessages(
  messages: Message[],
  aliases: Record<string, string> = {},
): { messages: Message[]; counts: RedactionCounts } {
  const totals: RedactionCounts = { phones: 0, emails: 0, numbers: 0 };

  const redacted = messages.map((message) => {
    const { text, counts } = redactText(message.text);
    totals.phones += counts.phones;
    totals.emails += counts.emails;
    totals.numbers += counts.numbers;

    const sender = message.sender === null ? null : (aliases[message.sender] ?? message.sender);
    return { ...message, sender, text };
  });

  return { messages: redacted, counts: totals };
}
