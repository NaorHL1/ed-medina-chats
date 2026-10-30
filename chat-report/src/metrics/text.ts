const WORD = /[\p{L}\p{N}']+/gu;

/** Common function words that carry no personality. Kept small on purpose. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'is', 'it', 'i', 'you', 'he', 'she',
  'we', 'they', 'me', 'my', 'your', 'this', 'that', 'for', 'with', 'be', 'are', 'was', 'so', 'do', 'not',
  'no', 'yes', 'ok', 'im', "i'm", "it's", 'just', 'what', 'if', 'as', 'by', 'from', 'up', 'out', 'its',
  'של', 'את', 'זה', 'זו', 'לא', 'כן', 'מה', 'מי', 'על', 'עם', 'אני', 'אתה', 'אבל', 'גם', 'או', 'יש', 'אין',
  'כל', 'כי', 'אם', 'הוא', 'היא', 'הם', 'הן', 'אז', 'כבר', 'רק', 'אתה', 'אנחנו',
]);

const QUESTION = /[?？]/;

const LAUGHTER = /haha|hehe|lol|lmao|חח+|😂|🤣/i;

const WARMTH = /❤|♥|💕|💖|💗|😍|😘|love you|אוהב|אוהבת|מותק|נשמה|כפרה/i;

const EMOJI = /\p{Extended_Pictographic}/gu;

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(WORD) ?? []).map((token) => token.replace(/^'+|'+$/g, '')).filter(Boolean);
}

/** Adjacent non-stopword pairs inside one message. Pairs never cross a message boundary. */
export function wordPairs(text: string): string[] {
  const tokens = tokenize(text).filter((token) => !STOPWORDS.has(token));
  const pairs: string[] = [];
  for (let i = 0; i + 1 < tokens.length; i++) {
    pairs.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return pairs;
}

export function isQuestion(text: string): boolean {
  return QUESTION.test(text);
}

export function isLaughter(text: string): boolean {
  return LAUGHTER.test(text);
}

export function isWarm(text: string): boolean {
  return WARMTH.test(text);
}

export function emojiOf(text: string): string[] {
  return text.match(EMOJI) ?? [];
}
