import { defineConfig } from 'vite';

// Inspection labs (whitebox-lab.html carries invulnerability, teleport and coin cheats) are served
// by `vite` in development. Production ships only the game; `npm run build:labs` makes an internal build.
export default defineConfig(({ mode }) => ({
  server: { port: 5173, strictPort: false, open: false },
  build: {
    target: 'es2022', chunkSizeWarningLimit: 2000,
    rollupOptions: { input: mode === 'labs' ? { game: 'index.html', whitebox: 'whitebox-lab.html', plateau: 'plateau-lab.html' } : { game: 'index.html' } },
  },
}));
