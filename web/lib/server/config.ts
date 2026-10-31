import { billingMode } from './billing';

export interface ConfigProblem {
  key: string;
  message: string;
}

/**
 * What a production server needs before it can serve people. Returns problems in words, never values.
 * The billing choice is only required in production; the dev stub covers it elsewhere.
 */
export function configProblems(env: Record<string, string | undefined> = process.env): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  const production = env['NODE_ENV'] === 'production';

  const key = env['ENCRYPTION_KEY'];
  if (!key || Buffer.from(key, 'base64').length !== 32) {
    problems.push({ key: 'ENCRYPTION_KEY', message: 'Set ENCRYPTION_KEY to 32 random bytes in base64 (openssl rand -base64 32).' });
  }
  if (!env['GROQ_API_KEY']) problems.push({ key: 'GROQ_API_KEY', message: 'Set GROQ_API_KEY so reports can be written.' });
  if (!env['GROQ_MODEL']) problems.push({ key: 'GROQ_MODEL', message: 'Set GROQ_MODEL, for example openai/gpt-oss-20b.' });
  if (production && billingMode(env) === 'unset') {
    problems.push({ key: 'BILLING_MODE', message: 'Set BILLING_MODE=free for launch without payment, or Stripe keys.' });
  }
  return problems;
}
