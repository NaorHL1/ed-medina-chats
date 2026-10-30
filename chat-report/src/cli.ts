import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { analyzeChat, runReport, type Analysis } from './analyze.js';
import { GroqClient } from './pipeline/groq.js';
import type { ModelClient } from './pipeline/run.js';

const USAGE = `Usage: chat-report <export.txt> [options]

Parses, redacts and counts one WhatsApp export and prints the metrics as JSON.

Options:
  --alias <Real=Nickname>  Rename a participant. Repeat for each person.
  --out <file>             Write the JSON to a file instead of stdout.
  --dates <dmy|mdy>        Force the date order instead of inferring it.

Model report (needs GROQ_API_KEY; no report runs without --report):
  --report <type>          Report type, such as "full-read". Written into the prompt.
  --persona <file>         JSON file: { "name": "...", "card": "..." }.
  --model <name>           Groq model id. Also read from GROQ_MODEL.
  --language <he|en>       Default: en.
  --intensity <1-5>        Default: 3 (honest).
  --resources <text>       Support resources shown in care mode.
`;

export interface CliOptions {
  input: string;
  aliases: Record<string, string>;
  out?: string;
  dates?: 'dmy' | 'mdy';
  report?: string;
  persona?: string;
  model?: string;
  language: 'he' | 'en';
  intensity: 1 | 2 | 3 | 4 | 5;
  resources?: string;
}

/** Parses `Real=Nickname` pairs. Throws on anything else so a typo never silently renames nobody. */
export function parseAliases(values: string[]): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const value of values) {
    const at = value.indexOf('=');
    const real = value.slice(0, at).trim();
    const nickname = value.slice(at + 1).trim();
    if (at <= 0 || nickname === '') throw new Error(`--alias expects Real=Nickname, got "${value}"`);
    aliases[real] = nickname;
  }
  return aliases;
}

export function readCliOptions(argv: string[]): CliOptions | 'help' {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      alias: { type: 'string', multiple: true },
      out: { type: 'string' },
      dates: { type: 'string' },
      report: { type: 'string' },
      persona: { type: 'string' },
      model: { type: 'string' },
      language: { type: 'string', default: 'en' },
      intensity: { type: 'string', default: '3' },
      resources: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });

  if (values.help) return 'help';
  if (positionals.length !== 1) throw new Error('Pass exactly one export file.');

  const language = values.language;
  if (language !== 'he' && language !== 'en') throw new Error('--language must be he or en.');
  const intensity = Number(values.intensity);
  if (!Number.isInteger(intensity) || intensity < 1 || intensity > 5) throw new Error('--intensity must be 1 to 5.');
  const dates = values.dates;
  if (dates !== undefined && dates !== 'dmy' && dates !== 'mdy') throw new Error('--dates must be dmy or mdy.');

  return {
    input: positionals[0]!,
    aliases: parseAliases(values.alias ?? []),
    out: values.out,
    dates,
    report: values.report,
    persona: values.persona,
    model: values.model ?? process.env['GROQ_MODEL'],
    language,
    intensity: intensity as CliOptions['intensity'],
    resources: values.resources,
  };
}

/** The summary a person can read: no transcript, no message text. */
export function summarize(analysis: Analysis): Omit<Analysis, 'transcript'> {
  const { transcript: _transcript, ...summary } = analysis;
  return summary;
}

async function readPersona(path: string): Promise<{ name: string; card: string }> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as { name?: unknown; card?: unknown };
  if (typeof parsed.name !== 'string' || typeof parsed.card !== 'string') {
    throw new Error('--persona file must be JSON with string fields "name" and "card".');
  }
  return { name: parsed.name, card: parsed.card };
}

export async function main(argv: string[]): Promise<number> {
  const options = readCliOptions(argv);
  if (options === 'help') {
    process.stdout.write(USAGE);
    return 0;
  }

  // Exports from some phones start with a byte-order mark that would otherwise end up in the first sender name.
  const text = (await readFile(options.input, 'utf8')).replace(/^﻿/, '');
  const analysis = analyzeChat(text, { aliases: options.aliases, dateOrder: options.dates });

  let output: unknown = summarize(analysis);
  if (options.report) {
    const apiKey = process.env['GROQ_API_KEY'];
    if (!apiKey) throw new Error('--report needs GROQ_API_KEY in the environment.');
    if (!options.model) throw new Error('--report needs --model or GROQ_MODEL.');
    if (!options.persona) throw new Error('--report needs --persona <file>.');

    const client: ModelClient = new GroqClient({ apiKey, model: options.model });
    const result = await runReport(
      analysis,
      {
        reportType: options.report,
        language: options.language,
        intensity: options.intensity,
        persona: await readPersona(options.persona),
        localResources: options.resources ?? '',
      },
      client,
    );
    output = { summary: output, result };
  }

  const json = `${JSON.stringify(output, null, 2)}\n`;
  if (options.out) {
    await writeFile(options.out, json, 'utf8');
    process.stderr.write(`Wrote ${options.out}\n`);
  } else {
    process.stdout.write(json);
  }
  return 0;
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`chat-report: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
