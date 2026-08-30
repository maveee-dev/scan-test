import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const commit = (
    env.VITE_GIT_COMMIT ??
    process.env.VITE_GIT_COMMIT ??
    process.env.VERCEL_GIT_COMMIT_SHA ??
    'dev'
  ).trim()

  return {
    plugins: [react()],
    define: {
      'import.meta.env.VITE_GIT_COMMIT': JSON.stringify(commit),
    },
  }
})
