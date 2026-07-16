import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const frontendPort = Number(process.env.VITE_PORT ?? 22026);
const backendTarget = process.env.VITE_BACKEND_TARGET ?? 'http://127.0.0.1:20262';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: frontendPort,
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
    },
  },
});
