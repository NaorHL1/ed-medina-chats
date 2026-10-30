import type { Message } from '../types.js';

/** Words and phrases no report may use. Enforced in code as well as in the critic's rubric. */
export const BANNED_PHRASES = [
  'buckle up',
  "let's dive in",
  "it's giving",
  'spill the tea',
  'rent-free',
  'we need to talk about',
  'as an ai',
  'toxic',
  'gaslighting',
  'narcissist',
  'love bombing',
];

export function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match);
}

/** One line per message in the form the prompts expect: `id|person|timestamp|text`. */
export function transcriptLines(messages: Message[], personIds: Record<string, string>): string {
  return messages
    .filter((m) => m.sender !== null)
    .map((m) => {
      const who = personIds[m.sender!] ?? 'P?';
      return `${m.id}|${who}|${new Date(m.ts).toISOString().slice(0, 16)}|${m.text.replace(/\n/g, ' ⏎ ')}`;
    })
    .join('\n');
}

export const EXTRACTOR_PROMPT = `You extract material from one era of a chat. Later steps will write the report.
You do not write jokes, judgments or advice. Output JSON only.

PARTICIPANTS: {participants}
ERA STATS: {era_stats_json}
MESSAGES:
{messages}

Return:
{
 "moments": [{"ids": [], "type": "turning_point|fight|sweet|funny|awkward|plan|apology", "summary": "max 20 words"}],
 "recurring_bits": [{"phrase": "", "first_id": "", "example_ids": [], "who": []}],
 "contrasts": [{"claim_id": "", "counter_ids": [], "metric_ref": null, "note": ""}],
 "signals": [{"person": "", "signal": "", "ids": [], "direction": "warmer|cooler|neutral"}],
 "strangest_message": {"id": "", "why": ""},
 "topics": [],
 "care_flags": [{"type": "self_harm|threat|abuse_or_control|minor_sexual|acute_distress", "ids": [], "severity": "low|medium|high"}]
}
Rules:
- Cite only ids that appear above. Never type quotes; ids only.
- Write summaries in English whatever the chat language.
- If unsure whether something happened, leave it out.
- For care_flags, include anything plausible; a false alarm is cheaper than a miss.`;

export const WRITER_PROMPT = `You are {persona_name}. Persona card:
{persona_card}

REPORT: {report_type}
INTENSITY: {intensity} ({intensity_name}). LANGUAGE: {language}.
PEOPLE: {participants}

RULES
1. Every insight cites message ids in "evidence" or a metric in "metric_refs". No evidence, no insight.
2. Numbers come only from METRICS, as whole numbers or percentages. Never estimate or recount.
3. Patterns, not mind-reading: "seems", "in this chat", "often".
4. Jokes target behavior in the chat only: never appearance, identity, health, money, trauma or anything a person cannot change.
5. No clinical or therapy labels. No advice to monitor, track or pressure anyone.
6. Use these techniques: stat punchline, say vs show, callback, receipt reveal, mock-formal frame, understatement, rule of three with a turn.
7. One joke per card at most, punchline last. Alternate funny and serious. End with one sincere "real talk" card.
8. Banned: {ban_list}. Max one slang phrase, three emoji.
9. If LANGUAGE is he, write native everyday Israeli Hebrew, not a translation.
10. Return only JSON matching the schema in the persona card.

METRICS: {metrics_json}
MATERIAL BANK: {material_bank_json}
EXCERPTS:
{messages}`;

export const CRITIC_PROMPT = `You are a comedy editor and a fact checker. Score every card in DRAFT.
For each card return {"card": n, "specificity": 1-5, "truth": 1-5, "surprise": 1-5, "brevity": 1-5,
"kindness_ok": true|false, "action": "keep|rewrite|cut", "rewrite": "new body or null"}.
Tests:
- Specificity: would this line still work for a random other chat? If yes, max 2.
- Truth: does the cited evidence actually show this? Check MATERIAL and METRICS.
- Kindness: is it within intensity {intensity} and the persona's rules?
Rewrite any card with a score under 4, using a technique it lacks. Cut it if no specific, true version exists.
Return a JSON array only.
DRAFT: {draft_json}
MATERIAL: {material_bank_json}
METRICS: {metrics_json}`;

export const JUDGE_PROMPT = `For each INSIGHT, decide whether the MESSAGES support the CLAIM.
Return a JSON array of {"card": n, "verdict": "supported|partly|unsupported", "reason": "max 15 words"}.
unsupported means the card will be removed. partly means its confidence will be set to low.
CLAIMS:
{claims}`;

export const CARE_PROMPT = `The chat may contain {care_flag_types}. Do not roast, joke or score anyone.
Write a short, calm, plain report: what the chat shows in neutral words, that the uploader's feelings make sense,
and where to get support ({local_resources}). No diagnoses. No advice to confront, track or monitor anyone.
Max 150 words. Return JSON only: {"summary": "string", "resources": ["string"]}.`;
