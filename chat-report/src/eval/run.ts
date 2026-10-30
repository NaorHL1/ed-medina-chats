import { pathToFileURL } from 'node:url';
import { EVAL_CASES, HOLDOUT_CASES } from './cases.js';
import { failedGates, PATTERNS, runEval, type EvalSummary } from './score.js';

export function formatSummary(summary: EvalSummary): string {
  const pct = (value: number | null) => (value === null ? 'n/a' : `${(value * 100).toFixed(0)}%`);
  const lines = [
    'case                         round-trip  numbers  initiation-err  patterns',
    ...summary.cases.map((c) => {
      const patterns = c.patterns
        .map((p) => `${p.pattern}:${p.planted ? (p.detected ? 'HIT' : 'MISS') : p.detected ? 'FALSE' : 'ok'}`)
        .join(' ');
      return `${c.id.padEnd(29)} ${String(c.roundTripOk).padEnd(11)} ${String(c.numbersOk).padEnd(8)} ${c.initiationError.toFixed(3).padEnd(15)} ${patterns}`;
    }),
    '',
    `planted recall   ${pct(summary.plantedRecall)}`,
    `false alarms     ${pct(summary.falseAlarmRate)}`,
    `numbers correct  ${pct(summary.numbersRate)}`,
    `round trip       ${pct(summary.roundTripRate)}`,
    `patterns scored  ${PATTERNS.join(', ')}`,
  ];
  return lines.join('\n');
}

/** Dev set first (used for tuning), then the held-out set. Both must pass every gate. */
export function main(): number {
  let exitCode = 0;
  for (const [label, cases] of [
    ['dev set (used for tuning)', EVAL_CASES],
    ['held-out set', HOLDOUT_CASES],
  ] as const) {
    const summary = runEval(cases);
    process.stdout.write(`== ${label}\n${formatSummary(summary)}\n\n`);
    const failures = failedGates(summary);
    for (const failure of failures) process.stderr.write(`FAILED (${label}): ${failure}\n`);
    if (failures.length > 0) exitCode = 1;
  }
  process.stdout.write(exitCode === 0 ? 'All gates pass.\n' : 'Gates failed.\n');
  return exitCode;
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) process.exitCode = main();
