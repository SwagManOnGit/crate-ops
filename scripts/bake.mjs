// Re-bakes the weapon sprites with Blender (headless):  npm run bake -- [ids...] [--sheet=name]
// Needs Blender 4.2+ and ffmpeg. Set BLENDER to the executable if it is not in the default place.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const guesses = [
  process.env.BLENDER,
  'C:/Program Files/Blender Foundation/Blender 5.1/blender.exe',
  'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe',
  '/Applications/Blender.app/Contents/MacOS/Blender',
  'blender',
].filter(Boolean);
const exe = guesses.find((p) => p === 'blender' || existsSync(p));
const res = spawnSync(exe, ['--background', '--factory-startup', '--python', 'art/render.py', '--', ...process.argv.slice(2)], { stdio: 'inherit' });
process.exit(res.status ?? 1);
