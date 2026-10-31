/**
 * Runs once when the server starts. A missing setting is logged by name at startup, so a bad deploy is
 * visible in the first line of the log instead of at the first user's click. It never prints a value.
 */
export async function register() {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  const { configProblems } = await import('./lib/server/config');
  for (const problem of configProblems()) {
    console.error(`[config] ${problem.key}: ${problem.message}`);
  }
}
