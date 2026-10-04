import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 5173, strictPort: false, open: false },
  build: {
    target: 'es2022', chunkSizeWarningLimit: 2000,
    rollupOptions: { input: { game: 'index.html', whitebox: 'whitebox-lab.html' } },
  },
});
