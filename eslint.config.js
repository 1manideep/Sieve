// Flat ESLint config (60 section 3.3). Bans and import boundaries from 40 section 17.2, 10 section 3 and 70 R-UI-09.
// ESLint 10: eslint-plugin-react does not support it yet, so its react/no-danger ban is the equivalent syntax rule below.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const APP_SRC = ['web/src/**/*.{ts,tsx}', 'extension/src/**/*.{ts,tsx}'];

/** Only web/src/ai/hybrid.ts, init.ts and device/adapter.ts may import firebase/ai at runtime (10 section 3). */
const FIREBASE_AI = {
  name: 'firebase/ai',
  message: 'Model calls go through web/src/ai (runModel and the task functions), so the trace is always recorded.',
};
/** Loaded only after Google sign-in, from app/services/*, relay/* and app/googleSession.ts (40 section 17.2). */
const GOOGLE_SESSION_ONLY = ['firebase/firestore', 'firebase/database', 'firebase/messaging', 'firebase/functions'].map((name) => ({
  name,
  message: 'Import this only from app/services/*, relay/* or app/googleSession.ts, so it stays out of the first load.',
}));

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/dist-*/**',
      'docs/**',
      'spikes/**',
      'data/**',
      'bench/**',
      'functions/**',
      // Vendor runtime, weights and pdf.js assets copied in at build time (gitignored, never edited by hand).
      'web/public/models/**',
      'web/public/ort/**',
      'web/public/pdfjs/**',
      '**/venv/**',
      '**/.venv/**',
      '.firebase/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}', '*.config.ts', '*/vite.config.ts', '*/vitest.config.ts', 'tests/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: APP_SRC,
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.flat.recommended.rules,
      'no-restricted-properties': [
        'error',
        { property: 'innerHTML', message: 'Render text with React; never inject HTML.' },
        { property: 'outerHTML', message: 'Render text with React; never inject HTML.' },
        { property: 'insertAdjacentHTML', message: 'Render text with React; never inject HTML.' },
        { object: 'document', property: 'write', message: 'Never write HTML into the document.' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          // react/no-danger
          selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
          message: 'Render text with React; never inject HTML (react/no-danger).',
        },
        {
          selector: "MemberExpression[property.name='startChat']",
          message: 'No multi-turn chat on private data: every model call is a single prompt (00 decision 3).',
        },
        {
          selector: "CallExpression[callee.object.name='window'][callee.property.name='open']",
          message: 'No window.open: a blob: or data: URL would run with Sieve\'s origin (70 R-UI-09).',
        },
        {
          selector: "JSXAttribute[name.name='href'] > Literal[value=/^(blob|data):/]",
          message: 'No links to blob: or data: URLs (70 R-UI-09).',
        },
        {
          // 70 R-UI-02: no href, src, srcSet or action is built from item, question or model text
          selector: "JSXAttribute[name.name=/^(href|src|srcSet|action)$/] MemberExpression[property.name=/^(text|title|preview|question|answer|from|caption|snippet|html|body)$/]",
          message: 'Never build a link, image source or form action from content (70 R-UI-02); show URLs as text.',
        },
      ],
      '@typescript-eslint/no-restricted-imports': ['error', { paths: [FIREBASE_AI] }],
    },
  },
  {
    // The shell, the router, shared components and the screens that load before sign-in.
    files: [
      'web/src/app/AppShell.tsx',
      'web/src/app/router.tsx',
      'web/src/app/routes.tsx',
      'web/src/components/**/*.{ts,tsx}',
      'web/src/screens/welcome/**/*.{ts,tsx}',
      'web/src/screens/playground/**/*.{ts,tsx}',
      'web/src/screens/prepare/**/*.{ts,tsx}',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { paths: [FIREBASE_AI, ...GOOGLE_SESSION_ONLY] }],
    },
  },
  {
    files: ['web/src/ai/types.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', { paths: [{ ...FIREBASE_AI, allowTypeImports: true }] }],
    },
  },
  {
    files: ['web/src/ai/hybrid.ts', 'web/src/ai/init.ts', 'web/src/ai/device/adapter.ts', 'web/src/ai/cloudAssistant.ts'],
    rules: { '@typescript-eslint/no-restricted-imports': 'off' },
  },
  {
    // Stubs keep the exact contract signatures; their parameters are unused until the owning package lands.
    files: ['web/src/ai/index.ts', 'web/src/pipeline/index.ts', 'web/src/privacy/index.ts', 'web/src/index/index.ts', 'web/src/sources/index.ts'],
    rules: { '@typescript-eslint/no-unused-vars': ['error', { args: 'none' }] },
  },
  {
    files: ['**/*.test.{ts,tsx}', 'web/src/test/**/*.{ts,tsx}'],
    rules: { 'react-hooks/rules-of-hooks': 'off' },
  },
);
