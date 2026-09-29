import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      // __BUILD_ID__ is stamped in by vite.config.js so the app can name its own build
      globals: { ...globals.browser, __BUILD_ID__: 'readonly' },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  {
    // Vercel serverless functions, the Electron entry point and the test scripts all run in
    // Node, not the browser, so they need Node globals (process, console, Buffer).
    files: ['api/**/*.{js,mjs}', 'scripts/**/*.{js,mjs}', 'main.cjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
])
