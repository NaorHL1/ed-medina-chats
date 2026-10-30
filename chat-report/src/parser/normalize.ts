import type { MessageKind } from '../types.js';

/** Invisible LTR/RTL marks and bidi controls that WhatsApp sprinkles into Hebrew and Arabic exports. */
const DIRECTION_MARKS = /[‎‏‪-‮⁦-⁩]/g;

/** Lines WhatsApp writes for events, never for a person. Matched before sender parsing. */
const SYSTEM_RE =
  /end-to-end encrypted|הודעות ושיחות מוצפנות|changed the subject|changed this group|changed the group|created group|יצר את הקבוצה|שינה את שם הקבוצה|changed their phone number|security code changed|Messages and calls/i;

const EDITED_RE = /\s*<(?:This message was edited|ההודעה נערכה|הודעה זו נערכה)>\s*$/i;

const DELETED_RE = /^(?:this message was deleted|you deleted this message|הודעה זו נמחקה|ההודעה נמחקה|נמחקה)\.?$/i;

const AUDIO_RE =
  /^(?:audio omitted|<audio omitted>|הודעה קולית(?: הושמטה)?|<attached: [^>]*(?:PTT-|\.opus|\.m4a|\.aac|\.mp3|\.ogg)[^>]*>)$/i;

const MEDIA_RE =
  /^(?:<media omitted>|image omitted|video omitted|sticker omitted|gif omitted|document omitted|<attached: [^>]*>|<המדיה הושמטה>|המדיה הושמטה|תמונה הושמטה|סרטון הושמט|מדבקה הושמטה)$/i;

/** Longest name we accept before a colon; anything longer is body text that happens to contain ": ". */
const MAX_SENDER_LENGTH = 60;

export function stripDirectionMarks(line: string): string {
  return line.replace(DIRECTION_MARKS, '');
}

export function splitSender(body: string): { sender: string | null; text: string; edited: boolean } {
  const edited = EDITED_RE.test(body);
  const cleaned = edited ? body.replace(EDITED_RE, '') : body;

  if (SYSTEM_RE.test(cleaned)) return { sender: null, text: cleaned, edited };

  const colon = cleaned.indexOf(': ');
  if (colon > 0 && colon <= MAX_SENDER_LENGTH && !cleaned.slice(0, colon).includes('\n')) {
    return { sender: cleaned.slice(0, colon).trim(), text: cleaned.slice(colon + 2), edited };
  }
  return { sender: null, text: cleaned, edited };
}

export function classifyText(text: string, hasSender: boolean): MessageKind {
  if (!hasSender) return 'system';
  const trimmed = text.trim();
  if (DELETED_RE.test(trimmed)) return 'deleted';
  if (AUDIO_RE.test(trimmed)) return 'audio';
  if (MEDIA_RE.test(trimmed)) return 'media';
  return 'text';
}
