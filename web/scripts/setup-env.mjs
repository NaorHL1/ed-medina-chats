// Creates or completes web/.env.local for a local or first production run.
// It keeps every value that is already there, adds only what is missing, and never prints a secret.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = join(dirname(fileURLToPath(import.meta.url)), '..', '.env.local');
const current = existsSync(file) ? readFileSync(file, 'utf8') : '';

const has = (key) => new RegExp(`^${key}=.+$`, 'm').test(current);
const lines = [];
const added = [];

function ensure(key, value) {
  if (has(key)) return;
  // An empty line such as GROQ_API_KEY= is replaced, not duplicated.
  lines.push([key, value]);
  added.push(key);
}

ensure('ENCRYPTION_KEY', randomBytes(32).toString('base64'));
ensure('BILLING_MODE', 'free');
ensure('GROQ_MODEL', 'openai/gpt-oss-20b');

let next = current;
for (const [key, value] of lines) {
  const empty = new RegExp(`^${key}=\\s*$`, 'm');
  next = empty.test(next) ? next.replace(empty, `${key}=${value}`) : `${next}${next && !next.endsWith('\n') ? '\n' : ''}${key}=${value}\n`;
}
if (!/^GROQ_API_KEY=/m.test(next)) next += 'GROQ_API_KEY=\n';

if (next !== current) writeFileSync(file, next);

console.log(added.length ? `Added to .env.local: ${added.join(', ')}` : '.env.local already has the required settings.');
if (!has('GROQ_API_KEY') && !/^GROQ_API_KEY=.+$/m.test(next)) {
  console.log('Still needed: put your Groq key on the GROQ_API_KEY= line of web/.env.local. Reports cannot be written without it.');
}
