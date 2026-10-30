# chat-report

The analysis engine behind the chat-report product. It turns a WhatsApp export
into messages with stable ids, redacts them, and computes every number a report
may cite. Models interpret these numbers; they never count them.

## Status: Step 1 (Foundations)

| Piece | Module | State |
| --- | --- | --- |
| Parser: iOS and Android, AM/PM, direction marks, multi-line, edits, deletions, media | `src/parser/` | done |
| Redaction (phones, emails, card-like numbers) and sender aliases | `src/redact.ts` | done |
| Metrics: conversations, turns, reply times, initiation, double-texts, questions, night owl, streaks, ghost gaps, signature phrases | `src/metrics/` | done |
| Era segmentation: silence and volume-shift boundaries, undersized eras merged by rhythm | `src/eras.ts` | done |
| Synthetic chats with planted patterns, and an exporter | `src/synthetic.ts` | done |
| Gate: 20 real exports parse with zero dropped messages | `test/synthetic.test.ts` | **proxy only**: 20 synthetic exports across both platforms, two languages, both date orders, 12h/24h clocks and a 5-person group. No real exports are in the repo yet. |
| Zip input (`_chat.txt` inside `.zip`) | — | deferred to Step 3, where the browser app owns file handling |

## Status: Step 2 (Pipeline lab), in progress

| Piece | Module | State |
| --- | --- | --- |
| Report schema with path-level errors | `src/report/types.ts` | done |
| Metric registry: person-qualified refs, printable numbers | `src/report/registry.ts` | done |
| Code-first verifier: evidence ids, refs, numbers, verbatim quotes, banned phrases, emoji | `src/report/verify.ts` | done |
| Pipeline: extractor, care routing, writer with one retry, critic (two rounds), judge | `src/pipeline/run.ts` | done, tested with a scripted model client |
| Prompt pack from the plan | `src/pipeline/prompts.ts` | done |
| Live model calls, eval set, rubric, blind comparison against a single-call baseline | — | **not run**: no model API key in this environment |
| CLI wrapper: `analyze` prints metrics as JSON; `--report` runs the pipeline through Groq | `src/cli.ts`, `src/analyze.ts` | done, tested with a stub client; live run not done (no key) |

Deviation from the plan: metric refs are person-qualified (`P1.initiation_rate`), because a
stat card that names no person is ambiguous. The prompts send ids, never names.

## CLI

```sh
npm run analyze -- chat.txt --alias "Naor=Me" --alias "Dana=Dani" --out summary.json
# model report (needs GROQ_API_KEY, GROQ_MODEL or --model, and a persona JSON file)
npm run analyze -- chat.txt --report full-read --model <groq-model> --persona persona.json
```

The summary holds no message text. Redaction runs before any counting, and the model sees only person ids.

## Conventions

- Timestamps are wall-clock time stored as UTC milliseconds, so day arithmetic never depends on the machine's timezone.
- Message ids are `m00001`, assigned in file order. Reports cite these ids.
- Rates are fractions from 0 to 1. Durations are milliseconds.
- An empty sample returns `null`, never `0`, so a missing reply time is not reported as an instant one.
- A "conversation" starts after 6 hours of silence. System lines never count toward any metric.

## Scripts

```sh
npm install
npm run check    # typecheck + tests
npm test         # tests only
```

## Known limits

- Day/month order is inferred from values above 12. A file where every date has day and month at most 12 falls back to day-first and emits a warning; the caller can pass `dateOrder`.
- Sender names are detected by the first `: ` on a line. A body that contains `: ` before any sender can be misread; the system-line list is deliberately narrow.
- Phone numbers of 9 to 12 digits are redacted; shorter plain numbers are kept because they are usually dates or counts.
- Signature phrases and laughter detection cover English and Hebrew only.

## Web app (Step 3a)

`web/` is a Next.js app that imports this engine as source. Upload, who-is-who and the free
Verdict run entirely in the browser: no network request is made. The Verdict is counted in
code (who opens conversations, reply speed, longest silence); no model is called.

```sh
cd web && npm install && npm run dev
```

Not built yet: server, database, Stripe, magic-link login, paid reports, zip upload.
