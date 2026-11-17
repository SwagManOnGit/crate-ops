// Weapon compositor. Each weapon ships as a baked "G-buffer" atlas (normals, AO,
// coverage, paint / accent / material masks, edge curvature) rendered in Blender.
// This shader paints the skin pattern onto it, chips the paint away according to the
// wear float and relights the result, so every drop is rendered uniquely on demand.
import { SKINS, WEAPONS, type Finish, type SkinDef } from './data';
import { KIND_FREE_ROT, KIND_SCALE, drawPattern, hexToRgb } from './patterns';
import { mulberry32, unit } from './rng';

export const TILE_W = 1280;
export const TILE_H = 640;
const THUMB_W = 320;
const THUMB_H = 160;

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uAtlas;
uniform sampler2D uPat;
uniform sampler2D uNoise;
uniform vec4 uXf;      // pattern offset.xy, rotation, scale
uniform float uWear;
uniform vec2 uSeed;
uniform vec3 uAccent;  // linear
uniform vec3 uGlowCol; // sRGB
uniform vec4 uFin;     // roughness, metalness, pearl, glow
uniform vec3 uL;
uniform vec4 uKind;    // x: 0 gun / 1 blade / 2 cloth, y: prime sparkle, z: has skin, w: accent glow

float tile(vec2 uv, float c, float r) {
  vec2 q = (vec2(c, r) + clamp(uv, 0.003, 0.997)) * vec2(0.5, 0.25);
  return texture2D(uAtlas, q).r;
}
vec3 toLin(vec3 c) { return pow(c, vec3(2.2)); }

// A small photo studio: overhead softbox, cool strip light on the left, warm kicker, dim floor.
vec3 env(vec3 R, float rough) {
  float blur = mix(0.03, 0.6, rough);
  float top = smoothstep(0.22 - blur, 0.62 + blur, R.y);
  float strip = smoothstep(0.5 - blur, 0.82 + blur * 0.5, -R.x * 0.85 + R.y * 0.2);
  float kick = smoothstep(0.3 - blur, 0.8 + blur, R.x * 0.9 - R.y * 0.15);
  float floorB = smoothstep(0.0, -0.8, R.y);
  // big diffuse fill behind the camera, so surfaces that face us never reflect pure black
  float front = smoothstep(0.3, 1.0, R.z);
  vec3 c = vec3(0.03, 0.035, 0.045) + front * vec3(0.3, 0.32, 0.35);
  c += top * vec3(1.0, 0.98, 0.95) * 1.55;
  c += strip * vec3(0.55, 0.72, 1.0) * 0.95;
  c += kick * vec3(1.0, 0.72, 0.45) * 0.4;
  c += floorB * vec3(0.5, 0.42, 0.34) * 0.12;
  return c * mix(1.0, 0.5, rough);
}

void main() {
  vec2 uv = vUv;
  float a = tile(uv, 1.0, 1.0);
  if (a < 0.004) { gl_FragColor = vec4(0.0); return; }
  float nx = tile(uv, 0.0, 0.0) * 2.0 - 1.0;
  float ny = tile(uv, 1.0, 0.0) * 2.0 - 1.0;
  vec3 N = normalize(vec3(nx, ny, sqrt(max(1.0 - nx * nx - ny * ny, 0.0)) + 0.03));
  float ao = tile(uv, 0.0, 1.0);
  float paint = tile(uv, 0.0, 2.0);
  float accent = tile(uv, 1.0, 2.0);
  float mat = tile(uv, 0.0, 3.0);
  float edge = tile(uv, 1.0, 3.0);
  float convex = max(edge - 0.5, 0.0) * 2.0;
  float crease = max(0.5 - edge, 0.0) * 2.0;
  vec2 pa = vec2(uv.x * 2.0, uv.y);

  vec4 nA = texture2D(uNoise, pa * 1.3 + uSeed);
  vec4 nB = texture2D(uNoise, pa * 5.3 + uSeed.yx * 3.7);
  float streak = texture2D(uNoise, vec2(pa.x * 2.2 + pa.y * 0.6, pa.y * 31.0) + uSeed).b;
  float field = nA.r * 0.5 + nB.g * 0.3 + streak * 0.2;

  // bare materials: polymer, rubber, gunmetal, bright steel
  float metalMask = smoothstep(0.24, 0.5, mat);
  float brightMask = smoothstep(0.62, 0.95, mat);
  float rubber = smoothstep(0.04, 0.1, mat) * (1.0 - smoothstep(0.16, 0.24, mat));
  vec3 baseAlb = mix(vec3(0.02, 0.022, 0.025), vec3(0.24, 0.25, 0.27), metalMask);
  baseAlb = mix(baseAlb, vec3(0.6, 0.61, 0.64), brightMask);
  baseAlb = mix(baseAlb, vec3(0.04, 0.04, 0.042), rubber);
  baseAlb *= 0.86 + 0.28 * nB.a;
  float baseRough = mix(0.56, 0.36, metalMask);
  baseRough = mix(baseRough, 0.22, brightMask);
  baseRough = mix(baseRough, 0.88, rubber);
  float baseMetal = metalMask;

  // skin coat
  float covRaw = clamp(paint + accent, 0.0, 1.0);
  float cov = covRaw * uKind.z;
  float cs = cos(uXf.z);
  float sn = sin(uXf.z);
  vec2 pp = (pa - vec2(1.0, 0.5)) * uXf.w;
  pp = vec2(cs * pp.x - sn * pp.y, sn * pp.x + cs * pp.y) + uXf.xy + N.xy * 0.03;
  vec3 patS = texture2D(uPat, pp).rgb;
  float accentK = accent / max(paint + accent, 0.001);
  vec3 skinAlb = mix(toLin(patS), uAccent, accentK);
  float glowM = uFin.w * mix(1.0 - smoothstep(0.1, 0.36, distance(patS, uGlowCol)), uKind.w, accentK);

  // wear: paint chips first on convex edges, then spreads across the flats
  float w = uWear;
  float thr = 0.18 + 0.33 * pow(w, 0.85);
  float h = field - convex * 0.42 * smoothstep(0.02, 0.3, w) + crease * 0.12;
  float worn = (1.0 - smoothstep(thr - 0.02, thr + 0.02, h)) * smoothstep(0.0, 0.05, w);
  // a darker primer ring hugs every chip once the item has seen some use
  float ring = mix(1.0, smoothstep(thr + 0.015, thr + 0.075, h), smoothstep(0.03, 0.15, w));
  float grime = (crease * 0.55 + (1.0 - nA.g) * 0.3) * w;

  vec3 underAlb;
  float underMetal;
  float underRough;
  if (uKind.x < 0.5) {
    underAlb = vec3(0.38, 0.39, 0.41) * (0.8 + 0.4 * nB.r);
    underMetal = 1.0;
    underRough = 0.44;
  } else if (uKind.x < 1.5) {
    underAlb = vec3(0.6, 0.61, 0.64) * (0.85 + 0.3 * streak);
    underMetal = 1.0;
    underRough = 0.2;
  } else {
    // cloth does not chip: it fades and gets dusty
    float lum = dot(skinAlb, vec3(0.3, 0.6, 0.1));
    underAlb = mix(skinAlb, vec3(lum) * 0.8 + vec3(0.05, 0.045, 0.035), 0.75);
    underMetal = 0.0;
    underRough = 0.95;
    worn *= 0.8;
  }
  vec3 coatAlb = skinAlb * mix(0.5, 1.0, ring) * (1.0 - grime * 0.6);
  float coatRough = clamp(uFin.x + w * 0.2 + grime * 0.25, 0.06, 1.0);
  float coatMetal = uFin.y;
  if (uKind.x > 1.5) {
    // woven fabric micro-texture
    float weave = texture2D(uNoise, pa * 46.0).a;
    coatAlb *= 0.82 + 0.36 * weave;
  }

  vec3 alb = mix(baseAlb, mix(coatAlb, underAlb, worn), cov);
  float rough = mix(baseRough, mix(coatRough, underRough, worn), cov);
  float metal = mix(baseMetal, mix(coatMetal, underMetal, worn), cov);
  float coat = cov * (1.0 - worn);

  // pearlescent colour shift
  vec3 iri = 0.5 + 0.5 * cos(6.2831 * (vec3(0.0, 0.33, 0.67) + N.x * 0.9 + N.y * 0.7 + pa.x * 0.3 + nA.b * 0.3));
  alb = mix(alb, alb * (0.5 + iri), uFin.z * coat * 0.75);

  // lighting
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L = normalize(uL);
  vec3 H = normalize(L + V);
  float NdL = max(dot(N, L), 0.0);
  float NdH = max(dot(N, H), 0.0);
  float NdV = max(N.z, 0.05);
  vec3 F0 = mix(vec3(0.04), alb, metal);
  float fres = pow(1.0 - NdV, 5.0);
  vec3 F = F0 + (max(vec3(1.0 - rough), F0) - F0) * fres;
  float a2 = max(rough * rough * rough * rough, 0.0005);
  float d = NdH * NdH * (a2 - 1.0) + 1.0;
  float D = min(a2 / (3.14159 * d * d), 24.0);
  float occ = ao * ao;
  vec3 keyCol = vec3(1.0, 0.97, 0.92) * 2.35;
  vec3 L2 = normalize(vec3(0.75, -0.3, 0.55));
  vec3 amb = mix(vec3(0.15, 0.14, 0.13), vec3(0.5, 0.55, 0.62), N.y * 0.5 + 0.5);
  vec3 col = alb * (1.0 - metal) * (keyCol * NdL + vec3(0.55, 0.72, 1.0) * 0.32 * max(dot(N, L2), 0.0) + amb) * occ;
  col += F * D * NdL * 0.25 * keyCol * occ;
  vec3 R = reflect(-V, N);
  float clothK = uKind.x > 1.5 ? mix(1.0, 0.25, covRaw) : 1.0;
  // a soft sheen band that slides across flat faces as the light moves
  float band = 0.5 + 0.5 * sin((pa.x * 1.5 - pa.y * 1.2) * 3.2 + uL.x * 5.0 + uL.y * 3.0);
  vec3 envC = env(R, rough) + vec3(0.26, 0.27, 0.3) * band * smoothstep(0.55, 1.0, R.z) * (1.0 - rough * 0.6);
  col += envC * F * mix(0.3, 1.0, ao) * clothK;
  // fabric sheen
  if (uKind.x > 1.5) col += alb * pow(1.0 - NdV, 2.5) * 0.9 * covRaw * occ;
  // pearl tints the highlight
  col += iri * uFin.z * coat * (0.1 + 0.5 * fres) * env(R, 0.3) * 0.5;
  // emissive linework
  col += toLin(uGlowCol) * glowM * coat * 1.9;
  // prime patterns carry a fine gold fleck
  float fleck = step(0.972, fract(sin(dot(floor(pa * 190.0), vec2(12.9898, 78.233))) * 43758.5453));
  col += vec3(1.0, 0.78, 0.3) * fleck * uKind.y * coat * (0.5 + 5.0 * pow(NdH, 6.0));

  // ACES-ish tone map + gamma
  col = (col * (2.51 * col + 0.03)) / (col * (2.43 * col + 0.59) + 0.14);
  col = pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
  gl_FragColor = vec4(col * a, a);
}`;

const FINISH: Record<Finish, [number, number, number]> = {
  matte: [0.72, 0.0, 0],
  satin: [0.46, 0.0, 0],
  gloss: [0.17, 0.0, 0],
  metal: [0.34, 0.85, 0],
  chrome: [0.11, 1.0, 0],
  pearl: [0.22, 0.4, 1],
  cloth: [0.92, 0.0, 0],
};

export interface DrawSpec {
  /** Weapon atlas id (or 'crate'). */
  weapon: string;
  skin: Pick<SkinDef, 'kind' | 'colors' | 'seed' | 'f' | 'a' | 'g' | 'sc'> | null;
  wear: number;
  pattern: number;
  prime?: boolean;
  /** 0 firearm, 1 blade, 2 cloth */
  kind?: number;
  /** Light offset from the default key direction, each roughly -1..1. */
  lx?: number;
  ly?: number;
}

interface Tex {
  tex: WebGLTexture;
  used: number;
}

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null;
  private prog: WebGLProgram | null = null;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private atlases = new Map<string, Tex>();
  private loading = new Map<string, Promise<boolean>>();
  private failed = new Set<string>();
  private pats = new Map<number, Tex>();
  private noise: WebGLTexture | null = null;
  private flat: WebGLTexture | null = null;
  private clock = 0;
  private maxTex = 4096;
  private scratch: HTMLCanvasElement;
  private sctx: CanvasRenderingContext2D;
  private thumbs = new Map<string, string>();
  private queue: { key: string; spec: DrawSpec }[] = [];
  private queued = new Set<string>();
  private pumping = false;
  ok = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = TILE_W;
    this.canvas.height = TILE_H;
    this.scratch = document.createElement('canvas');
    this.scratch.width = THUMB_W;
    this.scratch.height = THUMB_H;
    this.sctx = this.scratch.getContext('2d')!;
    const opts: WebGLContextAttributes = { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, preserveDrawingBuffer: true };
    this.gl = (this.canvas.getContext('webgl', opts) || this.canvas.getContext('experimental-webgl', opts)) as WebGLRenderingContext | null;
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.ok = false; });
    this.canvas.addEventListener('webglcontextrestored', () => this.init());
    this.init();
  }

  private init(): void {
    const gl = this.gl;
    if (!gl) return;
    this.atlases.clear();
    this.loading.clear();
    this.pats.clear();
    const sh = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    try {
      const p = gl.createProgram()!;
      gl.attachShader(p, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
      this.prog = p;
    } catch (err) {
      console.error('[render] shader failed', err);
      this.ok = false;
      return;
    }
    gl.useProgram(this.prog);
    for (const n of ['uAtlas', 'uPat', 'uNoise', 'uXf', 'uWear', 'uSeed', 'uAccent', 'uGlowCol', 'uFin', 'uL', 'uKind']) {
      this.u[n] = gl.getUniformLocation(this.prog!, n);
    }
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.prog!, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(this.u.uAtlas, 0);
    gl.uniform1i(this.u.uPat, 1);
    gl.uniform1i(this.u.uNoise, 2);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    this.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    this.noise = this.makeNoise();
    this.flat = this.patTexture(document.createElement('canvas'), true);
    this.ok = true;
  }

  /** Four independent seamless noise channels used for wear, grime and grain. */
  private makeNoise(): WebGLTexture {
    const gl = this.gl!;
    const S = 256;
    const rnd = mulberry32(0xc0ffee);
    const data = new Uint8Array(S * S * 4);
    for (let ch = 0; ch < 4; ch++) {
      const acc = new Float32Array(S * S);
      let amp = 1;
      let norm = 0;
      const base = ch === 3 ? 32 : 4;
      const octs = ch === 3 ? 2 : 5;
      for (let o = 0; o < octs; o++) {
        const c = base << o;
        const lat = new Float32Array(c * c);
        for (let i = 0; i < lat.length; i++) lat[i] = rnd();
        const k = c / S;
        for (let y = 0; y < S; y++) {
          const fy = y * k;
          const y0 = Math.floor(fy);
          const ty = fy - y0;
          const sy = ty * ty * (3 - 2 * ty);
          for (let x = 0; x < S; x++) {
            const fx = x * k;
            const x0 = Math.floor(fx);
            const tx = fx - x0;
            const sx = tx * tx * (3 - 2 * tx);
            const a0 = lat[(y0 % c) * c + (x0 % c)];
            const a1 = lat[(y0 % c) * c + ((x0 + 1) % c)];
            const b0 = lat[((y0 + 1) % c) * c + (x0 % c)];
            const b1 = lat[((y0 + 1) % c) * c + ((x0 + 1) % c)];
            acc[y * S + x] += (a0 + (a1 - a0) * sx + (b0 + (b1 - b0) * sx - (a0 + (a1 - a0) * sx)) * sy) * amp;
          }
        }
        norm += amp;
        amp *= 0.55;
      }
      // stretch contrast so thresholds in the shader cover a predictable range
      let lo = 1e9;
      let hi = -1e9;
      for (let i = 0; i < acc.length; i++) {
        const v = acc[i] / norm;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      for (let i = 0; i < acc.length; i++) data[i * 4 + ch] = Math.round(((acc[i] / norm - lo) / (hi - lo)) * 255);
    }
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, S, S, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  private patTexture(cv: HTMLCanvasElement, blank = false): WebGLTexture {
    const gl = this.gl!;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (blank) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([90, 92, 96, 255]));
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return tex;
  }

  private pattern(skin: NonNullable<DrawSpec['skin']>): WebGLTexture {
    const hit = this.pats.get(skin.seed);
    if (hit) {
      hit.used = ++this.clock;
      return hit.tex;
    }
    const tex = this.patTexture(drawPattern(skin));
    this.pats.set(skin.seed, { tex, used: ++this.clock });
    this.evict(this.pats, 28);
    return tex;
  }

  private evict<K>(map: Map<K, Tex>, max: number): void {
    while (map.size > max) {
      let oldest: K | null = null;
      let t = Infinity;
      for (const [k, v] of map) if (v.used < t) { t = v.used; oldest = k; }
      if (oldest === null) return;
      this.gl!.deleteTexture(map.get(oldest)!.tex);
      map.delete(oldest);
    }
  }

  private atlasKey(weapon: string, full: boolean): string {
    return weapon + (full && this.maxTex >= 2560 ? '' : '_s');
  }

  hasAtlas(weapon: string, full: boolean): boolean {
    return this.atlases.has(this.atlasKey(weapon, full));
  }

  /** Load a weapon atlas (small = thumbnail resolution). Resolves false if it is missing. */
  ensure(weapon: string, full: boolean): Promise<boolean> {
    const key = this.atlasKey(weapon, full);
    if (!this.gl || !this.ok || this.failed.has(key)) return Promise.resolve(false);
    if (this.atlases.has(key)) return Promise.resolve(true);
    const pending = this.loading.get(key);
    if (pending) return pending;
    const p = new Promise<boolean>((resolve) => {
      const img = new Image();
      img.onload = () => {
        const gl = this.gl!;
        try {
          const tex = gl.createTexture()!;
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, gl.LUMINANCE, gl.UNSIGNED_BYTE, img);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          this.atlases.set(key, { tex, used: ++this.clock });
          // full atlases are big: keep only a handful resident
          const fulls = new Map([...this.atlases].filter(([k]) => !k.endsWith('_s')));
          if (fulls.size > 5) {
            let oldest = '';
            let t = Infinity;
            for (const [k, v] of fulls) if (v.used < t && k !== key) { t = v.used; oldest = k; }
            if (oldest) {
              gl.deleteTexture(this.atlases.get(oldest)!.tex);
              this.atlases.delete(oldest);
            }
          }
          resolve(true);
        } catch {
          this.failed.add(key);
          resolve(false);
        }
        this.loading.delete(key);
      };
      img.onerror = () => {
        this.failed.add(key);
        this.loading.delete(key);
        resolve(false);
      };
      img.src = `weapons/${key}.webp`;
    });
    this.loading.set(key, p);
    return p;
  }

  /** Draw into the shared GL canvas; returns the source rect to blit from, or null if not ready. */
  private render(spec: DrawSpec, w: number, h: number, full: boolean): { sx: number; sy: number; sw: number; sh: number } | null {
    const gl = this.gl;
    if (!gl || !this.ok) return null;
    let key = this.atlasKey(spec.weapon, full);
    let atlas = this.atlases.get(key);
    if (!atlas && full) {
      key = this.atlasKey(spec.weapon, false);
      atlas = this.atlases.get(key);
    }
    if (!atlas) return null;
    atlas.used = ++this.clock;
    w = Math.min(TILE_W, Math.max(8, Math.round(w)));
    h = Math.min(TILE_H, Math.max(4, Math.round(h)));
    gl.viewport(0, 0, w, h);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, atlas.tex);
    gl.activeTexture(gl.TEXTURE1);
    const skin = spec.skin;
    gl.bindTexture(gl.TEXTURE_2D, skin ? this.pattern(skin) : this.flat);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.noise);
    const seed = skin ? skin.seed : 1;
    const p = spec.pattern;
    const h1 = unit(seed ^ 0xa1, p);
    const h2 = unit(seed ^ 0xb2, p);
    const h3 = unit(seed ^ 0xc3, p);
    const h4 = unit(seed ^ 0xd4, p);
    const kind = skin ? skin.kind : 'solid';
    const rot = KIND_FREE_ROT[kind] ? h3 * Math.PI * 2 : (h3 - 0.5) * 0.7;
    const scale = (skin?.sc || 1) * KIND_SCALE[kind] * (0.9 + 0.2 * h4);
    gl.uniform4f(this.u.uXf, h1, h2, rot, scale);
    gl.uniform1f(this.u.uWear, spec.wear);
    gl.uniform2f(this.u.uSeed, unit(seed ^ 0x77, p * 7 + 1), unit(seed ^ 0x99, p * 13 + 5));
    const cols = skin ? skin.colors : ['#5a5c60'];
    const accent = hexToRgb(skin?.a || cols[Math.min(1, cols.length - 1)]);
    gl.uniform3f(this.u.uAccent, Math.pow(accent[0] / 255, 2.2), Math.pow(accent[1] / 255, 2.2), Math.pow(accent[2] / 255, 2.2));
    const glowC = hexToRgb(cols[Math.min(1, cols.length - 1)]);
    gl.uniform3f(this.u.uGlowCol, glowC[0] / 255, glowC[1] / 255, glowC[2] / 255);
    const fin = FINISH[skin?.f || 'satin'];
    gl.uniform4f(this.u.uFin, fin[0], fin[1], fin[2], skin?.g || 0);
    const lx = spec.lx || 0;
    const ly = spec.ly || 0;
    gl.uniform3f(this.u.uL, -0.45 + lx * 0.9, 0.68 + ly * 0.7, 0.62);
    const accentGlows = Math.abs(accent[0] - glowC[0]) + Math.abs(accent[1] - glowC[1]) + Math.abs(accent[2] - glowC[2]) < 40 ? 0.7 : 0;
    gl.uniform4f(this.u.uKind, spec.kind ?? (WEAPONS[spec.weapon]?.kind || 0), spec.prime ? 1 : 0, skin ? 1 : 0, accentGlows);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.SCISSOR_TEST);
    return { sx: 0, sy: TILE_H - h, sw: w, sh: h };
  }

  /** Paint a weapon into a 2D canvas context at (0, 0, w, h). */
  drawTo(ctx: CanvasRenderingContext2D, spec: DrawSpec, w: number, h: number, full = true): boolean {
    const r = this.render(spec, w, h, full);
    ctx.clearRect(0, 0, w, h);
    if (!r) return false;
    ctx.drawImage(this.canvas, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
    return true;
  }

  // ------------------------------------------------------------ thumbnails

  /** Cached thumbnail URL, or a transparent pixel while it is generated. */
  thumb(key: string, spec: DrawSpec): string {
    const hit = this.thumbs.get(key);
    if (hit) return hit;
    if (!this.queued.has(key)) {
      this.queued.add(key);
      this.queue.push({ key, spec });
      this.pump();
    }
    return BLANK;
  }

  dropThumb(key: string): void {
    this.thumbs.delete(key);
  }

  private pump(): void {
    if (this.pumping) return;
    this.pumping = true;
    const step = async (): Promise<void> => {
      const t0 = performance.now();
      while (this.queue.length && performance.now() - t0 < 9) {
        const job = this.queue.shift()!;
        const ready = this.hasAtlas(job.spec.weapon, false) || (await this.ensure(job.spec.weapon, false));
        this.queued.delete(job.key);
        if (!ready) continue;
        if (!this.drawTo(this.sctx, job.spec, THUMB_W, THUMB_H, false)) continue;
        let url: string;
        try {
          url = this.scratch.toDataURL('image/webp', 0.9);
        } catch {
          continue;
        }
        if (this.thumbs.size > 900) {
          const first = this.thumbs.keys().next().value;
          if (first !== undefined) this.thumbs.delete(first);
        }
        this.thumbs.set(job.key, url);
        for (const el of document.querySelectorAll<HTMLImageElement>(`img[data-th="${job.key}"]`)) el.src = url;
      }
      if (this.queue.length) setTimeout(() => void step(), 0);
      else this.pumping = false;
    };
    setTimeout(() => void step(), 0);
  }
}

/** Draw spec for an owned item (or anything with skin / wear / pattern). */
export function specFor(it: { s: string; w: number; p: number }, prime = false): DrawSpec {
  const skin = SKINS[it.s];
  return { weapon: skin.weapon, skin, wear: it.w, pattern: it.p, prime };
}

/** Catalogue look of a skin: light wear, fixed pattern. */
export function specForSkin(skin: SkinDef): DrawSpec {
  return { weapon: skin.weapon, skin, wear: 0.04, pattern: skin.seed % 1000 };
}
