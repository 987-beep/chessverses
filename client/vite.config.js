import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/socket.io': { target: 'http://localhost:4000', ws: true },
      '/api': 'http://localhost:4000',
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
