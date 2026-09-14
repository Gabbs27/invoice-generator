import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // El mismo alias que tsconfig.json, para probar código de app/.
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  test: {
    environment: 'node',
  },
});
