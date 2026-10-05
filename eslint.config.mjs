import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['node_modules/', 'dist/', 'vendor/', 'build/', 'coverage/'] },
  js.configs.recommended,
  {
    rules: {
      // Rest destructuring is used to strip credentials from saved objects.
      'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', ignoreRestSiblings: true }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Main process, preloads, and tooling run as CommonJS in Node/Electron.
    files: ['src/main.js', 'src/main/**/*.js', 'src/preload.js', 'scripts/**/*.{js,cjs}', '**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    // The X WebView preload also touches the embedded page DOM.
    files: ['src/webview-preload.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['src/renderer.js', 'src/renderer/**/*.{js,mjs}'],
    languageOptions: { sourceType: 'module', globals: { ...globals.browser } },
  },
  {
    files: ['tests/**/*.js'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    // Playwright page.evaluate callbacks run in the app window.
    files: ['tests-e2e/**/*.js', 'tests-security/**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node, ...globals.browser } },
  },
];
