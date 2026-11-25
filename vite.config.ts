import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// The dev server watches the repo root; keep it out of the Unity project and the agent worktrees (each has its own
// unity/). Chokidar holds a handle on every folder it watches, and on Windows that blocks renaming the parent folder:
// while `npm run dev` ran, Unity's package manager could not move a freshly extracted package into
// unity/Library/PackageCache (EPERM), which made every -batchmode run exit 1.
// Also out: the gunfire-reborn-replica symlink (a whole Unity project on another drive; chokidar follows symlinks),
// Library/ and logfile/ (binary dumps), and the ~2.5 GB raw Unity scene export (exports/unity-levels-raw/,
// rewritten wholesale by every `bridge.sh webexport`). With those watched the server stopped answering any request.
// The raw export must stay outside public/: `vite build` copies public/ into dist/ verbatim, .gitignore does not stop it.
const repoRoot = fileURLToPath(new URL('.', import.meta.url)).replace(/\\/g, '/').toLowerCase();
const unwatchedDirs = ['unity/', '.claude/', 'gunfire-reborn-replica/', 'library/', 'logfile/', 'exports/', 'tests/.cache/']
  .map((dir) => repoRoot + dir);
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
    rollupOptions: { input: mode === 'labs' ? { game: 'index.html', whitebox: 'whitebox-lab.html', plateau: 'plateau-lab.html', originalWeapon: 'original-weapon.html', unityMap: 'unity-map.html', animLab: 'anim-lab.html', desertLab: 'desert-lab.html', desertPieces: 'desert-pieces.html' } : { game: 'index.html' } },
  },
}));
