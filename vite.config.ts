import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The dev server watches the repo root; keep it out of the Unity project and the agent worktrees (each has its own
// unity/). Chokidar holds a handle on every folder it watches, and on Windows that blocks renaming the parent folder:
// while `npm run dev` ran, Unity's package manager could not move a freshly extracted package into
// unity/Library/PackageCache (EPERM), which made every -batchmode run exit 1.
const repoRoot = fileURLToPath(new URL('.', import.meta.url)).replace(/\\/g, '/').toLowerCase();
const unwatchedDirs = ['unity/', '.claude/'].map((dir) => repoRoot + dir);
const isUnwatched = (path: string) => {
  const dir = path.replace(/\\/g, '/').toLowerCase() + '/';
  return unwatchedDirs.some((prefix) => dir.startsWith(prefix));
};

// Inspection labs (whitebox-lab.html carries invulnerability, teleport and coin cheats) are served
// by `vite` in development. Production ships only the game; `npm run build:labs` makes an internal build.
export default defineConfig(({ mode }) => ({
  server: { port: 5173, strictPort: false, open: false, watch: { ignored: [isUnwatched] } },
  build: {
    target: 'es2022', chunkSizeWarningLimit: 2000,
    rollupOptions: { input: mode === 'labs' ? { game: 'index.html', whitebox: 'whitebox-lab.html', plateau: 'plateau-lab.html' } : { game: 'index.html' } },
  },
}));
