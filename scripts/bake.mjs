// Re-builds the art with Blender (headless). Needs Blender 4.2+ and ffmpeg.
//   npm run bake -- [ids...] [--sheet=name]   weapon sprites (art/render.py)
//   npm run meshes -- [ids...] [--lod=0.6]    real-time 3D meshes (art/export_meshes.py)
//   npm run armory                            armory backdrop + depth map (art/armory.py)
// Set BLENDER to the executable if it is not in one of the default places.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const scripts = { sprites: 'art/render.py', meshes: 'art/export_meshes.py', armory: 'art/armory.py' };
const mode = scripts[process.argv[2]] ? process.argv[2] : 'sprites';
const rest = process.argv.slice(scripts[process.argv[2]] ? 3 : 2);
const guesses = [
  process.env.BLENDER,
  'C:/Program Files/Blender Foundation/Blender 5.1/blender.exe',
  'C:/Program Files/Blender Foundation/Blender 4.5/blender.exe',
  '/Applications/Blender.app/Contents/MacOS/Blender',
  'blender',
].filter(Boolean);
const exe = guesses.find((p) => p === 'blender' || existsSync(p));
const res = spawnSync(exe, ['--background', '--factory-startup', '--python', scripts[mode], '--', ...rest], { stdio: 'inherit' });
process.exit(res.status ?? 1);
