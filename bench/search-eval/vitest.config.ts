// The offline search eval runs the app's own search code in the web test environment (jsdom, fake IndexedDB, the
// web aliases and setup), but only this one file. `npm run check` never picks it up: no workspace includes bench/.
import { fileURLToPath, URL } from 'node:url';
import web from '../../web/vitest.config';

const base = web as { test?: Record<string, unknown> } & Record<string, unknown>;

export default {
  ...base,
  root: fileURLToPath(new URL('../../web', import.meta.url)),
  test: {
    ...base.test,
    name: 'search-eval',
    include: ['../bench/search-eval/search.eval.ts'],
    testTimeout: 3_600_000,
    hookTimeout: 3_600_000,
  },
};
