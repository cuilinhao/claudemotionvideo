import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  build: { rollupOptions: { input: { app: 'index.html', reference: 'reference.html' } } },
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
});
