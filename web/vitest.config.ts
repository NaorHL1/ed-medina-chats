import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: fileURLToPath(new URL('./', import.meta.url)) },
      { find: /^@engine\//, replacement: fileURLToPath(new URL('../chat-report/src/', import.meta.url)) },
    ],
  },
  test: {
    environment: 'node',
    server: { deps: { external: [/^node:/] } },
  },
});
