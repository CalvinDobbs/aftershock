import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * The dashboard had no test script at all, and `lib/room.ts` turns pipeline
 * artefacts into the conversation every judge reads. If that projection is
 * wrong, the demo is wrong in the most visible possible way.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['lib/**/*.test.ts', 'components/**/*.test.ts'],
  },
});
