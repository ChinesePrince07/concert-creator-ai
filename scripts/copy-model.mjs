// Copies the Basic Pitch TF.js model out of node_modules into public/ so the
// app is fully self-contained (no runtime network fetches).
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [
  join(root, 'node_modules/@spotify/basic-pitch/model'),
  join(root, 'node_modules/@spotify/basic-pitch/dist/model'),
];
const dest = join(root, 'public/models/basic-pitch');

const src = candidates.find((c) => existsSync(c));
if (!src) {
  console.warn('[copy-model] basic-pitch model not found in node_modules; transcription will be unavailable until `npm install` completes.');
  process.exit(0);
}
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`[copy-model] copied ${src} -> ${dest}`);
