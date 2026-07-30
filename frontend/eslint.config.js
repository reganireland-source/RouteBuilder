// ESLint configuration for the RouteBuilder frontend.
//
// WHY THIS EXISTS
// Our enterprise IT pipeline gates on SonarQube. SonarQube's JavaScript/
// TypeScript analyzer is published as `eslint-plugin-sonarjs`, so running it
// here reproduces the same rule set locally — we can find and fix the issues
// before the scan runs, and keep them from coming back.
//
// Run:  npx eslint src            (report)
//       npx eslint src --fix      (auto-fix what is mechanically fixable)
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import sonarjs from 'eslint-plugin-sonarjs'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'public/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  sonarjs.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        window: 'readonly', document: 'readonly', console: 'readonly',
        fetch: 'readonly', FormData: 'readonly', File: 'readonly', Blob: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly',
        clearInterval: 'readonly', requestAnimationFrame: 'readonly',
        sessionStorage: 'readonly', localStorage: 'readonly', navigator: 'readonly',
        AbortController: 'readonly', TextDecoder: 'readonly', URL: 'readonly',
        DataTransfer: 'readonly', FileList: 'readonly', HTMLElement: 'readonly',
        HTMLInputElement: 'readonly', HTMLTextAreaElement: 'readonly',
        HTMLCanvasElement: 'readonly', HTMLSelectElement: 'readonly',
        Image: 'readonly', ClipboardEvent: 'readonly', KeyboardEvent: 'readonly',
        MouseEvent: 'readonly', Event: 'readonly', ResizeObserver: 'readonly',
        SVGSVGElement: 'readonly', Element: 'readonly', React: 'readonly',
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
)
