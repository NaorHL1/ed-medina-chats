import { describe, expect, it } from 'vitest';
import { analyzeChat, runReport, type ReportRequest } from '../src/analyze.js';
import { parseAliases, readCliOptions, summarize } from '../src/cli.js';
import type { ModelClient, Stage } from '../src/pipeline/run.js';

const ANDROID = [
  '26/10/2026, 8:58 PM - Naor: hey, call me on 054-123-4567',
  '26/10/2026, 8:59 PM - Dana: hi there',
  '26/10/2026, 9:30 PM - Dana: <Media omitted>',
  '27/10/2026, 12:01 AM - Naor: late night, mail naor@example.com',
].join('\n');

class RecordingClient implements ModelClient {
  readonly prompts: string[] = [];

  async complete(stage: Stage, prompt: string): Promise<string> {
    this.prompts.push(`${stage}\n${prompt}`);
    return stage === 'extractor' ? '{"moments":[],"care_flags":[]}' : '{}';
  }
}

describe('parseAliases', () => {
  it('maps real names to nicknames and trims spaces', () => {
    expect(parseAliases(['Naor = Me', 'Dana=Dani'])).toEqual({ Naor: 'Me', Dana: 'Dani' });
  });

  it('rejects an entry without a real name or nickname', () => {
    expect(() => parseAliases(['=Me'])).toThrow(/Real=Nickname/);
    expect(() => parseAliases(['Naor'])).toThrow(/Real=Nickname/);
    expect(() => parseAliases(['Naor='])).toThrow(/Real=Nickname/);
  });
});

describe('readCliOptions', () => {
  it('requires exactly one export file', () => {
    expect(() => readCliOptions([])).toThrow(/exactly one/);
    expect(() => readCliOptions(['a.txt', 'b.txt'])).toThrow(/exactly one/);
  });

  it('returns help on -h', () => {
    expect(readCliOptions(['-h'])).toBe('help');
  });

  it('validates language, intensity and date order', () => {
    expect(() => readCliOptions(['a.txt', '--language', 'fr'])).toThrow(/he or en/);
    expect(() => readCliOptions(['a.txt', '--intensity', '6'])).toThrow(/1 to 5/);
    expect(() => readCliOptions(['a.txt', '--dates', 'ymd'])).toThrow(/dmy or mdy/);
  });

  it('applies defaults and collects repeated aliases', () => {
    const options = readCliOptions(['chat.txt', '--alias', 'Naor=Me', '--alias', 'Dana=Dani']);
    expect(options).toMatchObject({
      input: 'chat.txt',
      aliases: { Naor: 'Me', Dana: 'Dani' },
      language: 'en',
      intensity: 3,
    });
  });
});

describe('analyzeChat', () => {
  it('assigns person ids in order of first appearance and applies aliases before counting', () => {
    const analysis = analyzeChat(ANDROID, { aliases: { Naor: 'Me' } });

    expect(analysis.platform).toBe('android');
    expect(analysis.personIds).toEqual({ Me: 'P1', Dana: 'P2' });
    expect(analysis.metrics.participants).toEqual(['Me', 'Dana']);
    expect(analysis.metrics.people['Me']?.messages).toBe(2);
  });

  it('redacts phone numbers and emails before anything is counted or kept', () => {
    const analysis = analyzeChat(ANDROID);

    expect(analysis.redactions.phones).toBe(1);
    expect(analysis.redactions.emails).toBe(1);
    expect(JSON.stringify(analysis.transcript)).not.toMatch(/054-123-4567|naor@example\.com/);
  });

  it('keeps the transcript out of the summary', () => {
    const summary = summarize(analyzeChat(ANDROID));

    expect(summary).not.toHaveProperty('transcript');
    expect(summary.personIds).toBeDefined();
  });
});

describe('runReport', () => {
  it('sends the model person ids only, never the participant names', async () => {
    const analysis = analyzeChat(ANDROID, { aliases: { Naor: 'Me' } });
    const client = new RecordingClient();
    const request: ReportRequest = {
      reportType: 'full-read',
      language: 'en',
      intensity: 3,
      persona: { name: 'Judge', card: 'Measured and fair.' },
      localResources: 'ERAN',
    };

    // The stub writer returns no report on purpose: this test only inspects what the model was sent.
    await expect(runReport(analysis, request, client)).rejects.toThrow();

    const sent = client.prompts.join('\n');
    expect(client.prompts.length).toBeGreaterThan(0);
    expect(sent).toContain('P1');
    expect(sent).not.toMatch(/\bMe\b/);
    expect(sent).not.toContain('Dana');
  });
});
