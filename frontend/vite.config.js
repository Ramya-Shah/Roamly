import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// During `npm run dev` (not used in the container build, but handy for
// local iteration), proxy /api to the dashboard_api service so the app
// can always just call same-origin `/api/...` regardless of environment -
// in the container, nginx does the equivalent proxying instead.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:8001',
        changeOrigin: true,
      },
    },
  },
})
