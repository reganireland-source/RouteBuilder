import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { execSync } from 'child_process'

const gitOrDefault = (cmd: string, fallback: string) => {
  try { return execSync(cmd).toString().trim() || fallback }
  catch { return fallback }
}
const buildNumber = gitOrDefault('git rev-list --count HEAD', '0')
const buildCommit = gitOrDefault('git rev-parse --short=7 HEAD', 'unknown')
const buildBranch = gitOrDefault('git rev-parse --abbrev-ref HEAD', 'unknown')
const buildDirty = gitOrDefault('git status --porcelain', '') !== ''
// Full timestamp (not just a date) so two same-day builds are distinguishable.
const buildDate = new Date().toISOString().slice(0, 16).replace('T', ' ')

export default defineConfig({
  define: {
    __BUILD_NUMBER__: JSON.stringify(buildNumber),
    __BUILD_COMMIT__: JSON.stringify(buildCommit),
    __BUILD_BRANCH__: JSON.stringify(buildBranch),
    __BUILD_DIRTY__: JSON.stringify(buildDirty),
    __BUILD_DATE__: JSON.stringify(buildDate),
  },
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
