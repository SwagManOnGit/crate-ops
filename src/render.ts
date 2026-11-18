// Weapon rendering. Two views share one WebGL context and one material model:
//
//  * Sprite view (thumbnails, lists, roulette): each weapon ships as a baked "G-buffer"
//    atlas (normals, AO, coverage, paint / accent / material masks, edge curvature)
//    rendered in Blender. The shader paints the skin onto it, chips the paint away
//    according to the wear float and relights it.
//  * 3D view (reveal, inspect): the real mesh exported from the same Blender model. It is
//    shaded with the same material code, and the pattern, AO and wear are projected through
//    the sprite's bake camera, so the 3D item matches its thumbnail chip for chip.
import { SKINS, WEAPONS, type Finish, type SkinDef } from './data';
import { KIND_FREE_ROT, KIND_SCALE, drawPattern, hexToRgb } from './patterns';
import { mulberry32, unit } from './rng';

export const TILE_W = 1280;
export const TILE_H = 640;
const THUMB_W = 320;
const THUMB_H = 160;

const QUAD_VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

/** Shared material + lighting code. */
const COMMON = `
precision highp float;
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

// pattern placement for this drop: rotate, then offset
vec2 xf(vec2 q) {
  float cs = cos(uXf.z);
  float sn = sin(uXf.z);
  return vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y) + uXf.xy;
}

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

// N, V in view space. pa = sprite-space position (x 0..2, y 0..1) used for noise lookups.
vec3 surface(vec3 N, vec3 V, float ao, float paint, float accent, float mat, float convex, float crease, vec2 pa, vec3 patS) {
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
  vec3 L = normalize(uL);
  vec3 H = normalize(L + V);
  float NdL = max(dot(N, L), 0.0);
  float NdH = max(dot(N, H), 0.0);
  float NdV = max(dot(N, V), 0.05);
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
  return pow(clamp(col, 0.0, 1.0), vec3(1.0 / 2.2));
}
`;

const SPRITE_FRAG = COMMON + `
varying vec2 vUv;
void main() {
  vec2 uv = vUv;
  float a = tile(uv, 1.0, 1.0);
  if (a < 0.004) { gl_FragColor = vec4(0.0); return; }
  float nx = tile(uv, 0.0, 0.0) * 2.0 - 1.0;
  float ny = tile(uv, 1.0, 0.0) * 2.0 - 1.0;
  vec3 N = normalize(vec3(nx, ny, sqrt(max(1.0 - nx * nx - ny * ny, 0.0)) + 0.03));
  float edge = tile(uv, 1.0, 3.0);
  vec2 pa = vec2(uv.x * 2.0, uv.y);
  vec3 patS = texture2D(uPat, xf((pa - vec2(1.0, 0.5)) * uXf.w) + N.xy * 0.03).rgb;
  vec3 col = surface(N, vec3(0.0, 0.0, 1.0), tile(uv, 0.0, 1.0), tile(uv, 0.0, 2.0), tile(uv, 1.0, 2.0), tile(uv, 0.0, 3.0),
    max(edge - 0.5, 0.0) * 2.0, max(0.5 - edge, 0.0) * 2.0, pa, patS);
  gl_FragColor = vec4(col * a, a);
}`;

const MESH_VERT = `
attribute vec3 aPos;
attribute vec3 aNor;
attribute float aTag;
uniform vec3 uBMin;
uniform vec3 uBSize;
uniform mat3 uRot;
uniform vec3 uShiftV;   // view-space translation (after rotation)
uniform vec4 uProj;     // x scale, y scale, z scale, z offset
varying vec3 vObj;
varying vec3 vNObj;
varying vec3 vNView;
varying vec3 vView;
varying float vTag;
void main() {
  vec3 p = uBMin + aPos * uBSize;
  vObj = p;
  vNObj = aNor;
  vNView = uRot * aNor;
  vTag = aTag;
  vec3 pv = uRot * p + uShiftV;
  vView = pv;
  gl_Position = vec4(pv.x * uProj.x, pv.y * uProj.y, pv.z * uProj.z + uProj.w, -pv.z);
}`;

const MESH_FRAG = `#extension GL_OES_standard_derivatives : enable
` + COMMON + `
varying vec3 vObj;
varying vec3 vNObj;
varying vec3 vNView;
varying vec3 vView;
varying float vTag;
uniform vec3 uCamR;
uniform vec3 uCamU;
uniform vec3 uCamD;
uniform vec3 uCamC;   // centre x, centre y, ortho scale of the sprite bake camera
void main() {
  vec3 nO = normalize(vNObj);
  vec3 N = normalize(vNView);
#ifdef GL_OES_standard_derivatives
  // big flat panels: snap to the true face normal so triangulation never shows in the shading
  vec3 g = normalize(cross(dFdx(vView), dFdy(vView)));
  if (dot(g, N) < 0.0) g = -g;
  N = normalize(mix(N, g, smoothstep(0.972, 0.994, dot(g, N))));
#endif
  vec3 V = normalize(-vView);
  // where this point sits in the baked sprite
  float sx = dot(vObj, uCamR) - uCamC.x;
  float sy = dot(vObj, uCamU) - uCamC.y;
  float sz = dot(vObj, uCamD);
  float k = 2.0 / uCamC.z;
  vec2 uvS = vec2(0.5 + sx / uCamC.z, 0.5 - sy * k);
  vec2 pa = vec2(uvS.x * 2.0, uvS.y);
  // blend three projections in the bake camera's frame so no face shows stretched paint
  vec3 wgt = abs(vec3(dot(nO, uCamR), dot(nO, uCamU), dot(nO, uCamD)));
  wgt = wgt * wgt;
  wgt = wgt * wgt;
  wgt /= wgt.x + wgt.y + wgt.z;
  vec3 patS = texture2D(uPat, xf(vec2(sx, -sy) * k * uXf.w)).rgb * wgt.z
            + texture2D(uPat, xf(vec2(sx, -sz) * k * uXf.w)).rgb * wgt.y
            + texture2D(uPat, xf(vec2(sz, -sy) * k * uXf.w)).rgb * wgt.x;
  vec2 pn = wgt.z > 0.3 ? pa : (wgt.y > wgt.x ? vec2(1.0 + sx * k, 0.5 - sz * k) : vec2(1.0 + sz * k, 0.5 - sy * k));
  // baked AO and edge wear apply where the surface faces along the bake direction
  float fw = smoothstep(0.12, 0.55, abs(dot(nO, uCamD)));
  float ao = mix(1.0, tile(uvS, 0.0, 1.0), fw * 0.9);
  float edge = mix(0.5, tile(uvS, 1.0, 3.0), fw);
  float t = floor(vTag + 0.5);
  float paint = t < 0.5 ? 1.0 : 0.0;
  float accent = (t > 0.5 && t < 1.5) ? 1.0 : 0.0;
  float mat = t < 1.5 ? 0.75 : t < 2.5 ? 0.0 : t < 3.5 ? 0.12 : t < 4.5 ? 0.5 : 1.0;
  vec3 col = surface(N, V, ao, paint, accent, mat, max(edge - 0.5, 0.0) * 2.0, max(0.5 - edge, 0.0) * 2.0, pn, patS);
  gl_FragColor = vec4(col, 1.0);
}`;

/** Backdrop: a rendered armory with a depth map, shifted per pixel for parallax. */
const BG_FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uBg;
uniform sampler2D uBgD;
uniform vec2 uShift;
uniform vec3 uTint;
uniform float uAsp;   // < 1 when the window is narrower than the 2:1 picture: crop the sides
void main() {
  vec2 st = vec2((vUv.x - 0.5) * uAsp + 0.5, vUv.y);
  float d = texture2D(uBgD, st).r;
  vec2 uv = (st - 0.5) * 0.92 + 0.5 + uShift * (d - 0.3);
  vec3 c = texture2D(uBg, uv).rgb;
  vec2 q = (vUv - 0.5) * vec2(1.0, 1.7);
  c *= 0.78;
  c += uTint * exp(-dot(q, q) * 7.0) * 0.3;
  c *= 1.0 - 0.6 * smoothstep(0.3, 0.95, length(q));
  gl_FragColor = vec4(c, 1.0);
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

/** Camera state for the 3D view. */
export interface View3D {
  /** Turntable angle around the item's own vertical axis (radians). */
  spin: number;
  /** Extra tilt toward / away from the viewer (radians). */
  tilt: number;
  zoom: number;
  /** Draw the armory backdrop behind the item. */
  bg: boolean;
  /** Backdrop glow colour (0..1 rgb). */
  tint?: [number, number, number];
  /** Parallax offset, each roughly -1..1. */
  px: number;
  py: number;
}

interface Tex {
  tex: WebGLTexture;
  used: number;
}

interface Mesh {
  vbo: WebGLBuffer;
  ibo: WebGLBuffer;
  count: number;
  type: number;
  bmin: [number, number, number];
  size: [number, number, number];
  right: [number, number, number];
  up: [number, number, number];
  dir: [number, number, number];
  cam: [number, number, number];
  used: number;
}

type Prog = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
const SKIN_UNIFORMS = ['uAtlas', 'uPat', 'uNoise', 'uXf', 'uWear', 'uSeed', 'uAccent', 'uGlowCol', 'uFin', 'uL', 'uKind'];

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null;
  private sprite: Prog | null = null;
  private mesh: Prog | null = null;
  private bgProg: Prog | null = null;
  private quad: WebGLBuffer | null = null;
  private atlases = new Map<string, Tex>();
  private loading = new Map<string, Promise<boolean>>();
  private failed = new Set<string>();
  private pats = new Map<number, Tex>();
  private meshes = new Map<string, Mesh>();
  private meshLoading = new Map<string, Promise<boolean>>();
  private meshFailed = new Set<string>();
  private bgTex: WebGLTexture | null = null;
  private bgDepth: WebGLTexture | null = null;
  private bgLoading: Promise<boolean> | null = null;
  private uint32 = false;
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
    const opts: WebGLContextAttributes = { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, stencil: false, preserveDrawingBuffer: true };
    this.gl = (this.canvas.getContext('webgl', opts) || this.canvas.getContext('experimental-webgl', opts)) as WebGLRenderingContext | null;
    this.canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.ok = false; });
    this.canvas.addEventListener('webglcontextrestored', () => this.init());
    this.init();
  }

  private program(vert: string, frag: string, attribs: string[], uniforms: string[]): Prog {
    const gl = this.gl!;
    const sh = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader');
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, sh(gl.VERTEX_SHADER, vert));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, frag));
    attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link');
    const u: Record<string, WebGLUniformLocation | null> = {};
    for (const n of uniforms) u[n] = gl.getUniformLocation(p, n);
    return { p, u };
  }

  private init(): void {
    const gl = this.gl;
    if (!gl) return;
    this.atlases.clear();
    this.loading.clear();
    this.pats.clear();
    this.meshes.clear();
    this.meshLoading.clear();
    this.bgTex = this.bgDepth = null;
    this.bgLoading = null;
    try {
      this.sprite = this.program(QUAD_VERT, SPRITE_FRAG, ['aPos'], SKIN_UNIFORMS);
    } catch (err) {
      console.error('[render] sprite shader failed', err);
      this.ok = false;
      return;
    }
    gl.getExtension('OES_standard_derivatives');
    try {
      this.mesh = this.program(MESH_VERT, MESH_FRAG, ['aPos', 'aNor', 'aTag'],
        [...SKIN_UNIFORMS, 'uBMin', 'uBSize', 'uRot', 'uShiftV', 'uProj', 'uCamR', 'uCamU', 'uCamD', 'uCamC']);
      this.bgProg = this.program(QUAD_VERT, BG_FRAG, ['aPos'], ['uBg', 'uBgD', 'uShift', 'uTint', 'uAsp']);
    } catch (err) {
      // the sprite view still works without the 3D programs
      console.error('[render] 3D shaders failed', err);
      this.mesh = null;
      this.bgProg = null;
    }
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    for (const pr of [this.sprite, this.mesh]) {
      if (!pr) continue;
      gl.useProgram(pr.p);
      gl.uniform1i(pr.u.uAtlas, 0);
      gl.uniform1i(pr.u.uPat, 1);
      gl.uniform1i(pr.u.uNoise, 2);
    }
    if (this.bgProg) {
      gl.useProgram(this.bgProg.p);
      gl.uniform1i(this.bgProg.u.uBg, 3);
      gl.uniform1i(this.bgProg.u.uBgD, 4);
    }
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
    this.uint32 = !!gl.getExtension('OES_element_index_uint');
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

  private imageTexture(url: string, format: number): Promise<WebGLTexture | null> {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const gl = this.gl!;
        try {
          const tex = gl.createTexture()!;
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.texImage2D(gl.TEXTURE_2D, 0, format, format, gl.UNSIGNED_BYTE, img);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          resolve(tex);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  /** Load a weapon atlas (small = thumbnail resolution). Resolves false if it is missing. */
  ensure(weapon: string, full: boolean): Promise<boolean> {
    const key = this.atlasKey(weapon, full);
    if (!this.gl || !this.ok || this.failed.has(key)) return Promise.resolve(false);
    if (this.atlases.has(key)) return Promise.resolve(true);
    const pending = this.loading.get(key);
    if (pending) return pending;
    const p = this.imageTexture(`weapons/${key}.webp`, this.gl.LUMINANCE).then((tex) => {
      this.loading.delete(key);
      if (!tex) {
        this.failed.add(key);
        return false;
      }
      this.atlases.set(key, { tex, used: ++this.clock });
      // full atlases are big: keep only a handful resident
      const fulls = [...this.atlases].filter(([k]) => !k.endsWith('_s'));
      if (fulls.length > 5) {
        const oldest = fulls.filter(([k]) => k !== key).sort((a, b) => a[1].used - b[1].used)[0];
        if (oldest) {
          this.gl!.deleteTexture(oldest[1].tex);
          this.atlases.delete(oldest[0]);
        }
      }
      return true;
    });
    this.loading.set(key, p);
    return p;
  }

  // ------------------------------------------------------------ 3D assets

  hasMesh(weapon: string): boolean {
    return this.meshes.has(weapon);
  }

  /** Load the real-time mesh for a weapon. Resolves false if it is missing or unsupported. */
  ensureMesh(weapon: string): Promise<boolean> {
    if (!this.gl || !this.ok || !this.mesh || this.meshFailed.has(weapon)) return Promise.resolve(false);
    if (this.meshes.has(weapon)) return Promise.resolve(true);
    const pending = this.meshLoading.get(weapon);
    if (pending) return pending;
    const p = fetch(`models/${weapon}.bin`)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((buf) => {
        const gl = this.gl!;
        const dv = new DataView(buf);
        if (dv.getUint32(0, true) !== 0x48534d43) throw new Error('bad mesh'); // 'CMSH'
        const vcount = dv.getUint32(8, true);
        const icount = dv.getUint32(12, true);
        const isize = dv.getUint32(16, true);
        if (isize === 4 && !this.uint32) throw new Error('no uint32 indices');
        const f = (i: number): number => dv.getFloat32(20 + i * 4, true);
        const vOff = 92;
        const vLen = vcount * 10;
        const iOff = vOff + vLen + ((4 - (vLen % 4)) % 4);
        const vbo = gl.createBuffer()!;
        gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(buf, vOff, vLen), gl.STATIC_DRAW);
        const ibo = gl.createBuffer()!;
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint8Array(buf, iOff, icount * isize), gl.STATIC_DRAW);
        this.meshes.set(weapon, {
          vbo, ibo, count: icount, type: isize === 4 ? gl.UNSIGNED_INT : gl.UNSIGNED_SHORT,
          bmin: [f(0), f(1), f(2)],
          size: [f(3) - f(0), f(4) - f(1), f(5) - f(2)],
          right: [f(6), f(7), f(8)],
          up: [f(9), f(10), f(11)],
          dir: [f(12), f(13), f(14)],
          cam: [f(15), f(16), f(17)],
          used: ++this.clock,
        });
        if (this.meshes.size > 6) {
          const oldest = [...this.meshes].filter(([k]) => k !== weapon).sort((a, b) => a[1].used - b[1].used)[0];
          if (oldest) {
            gl.deleteBuffer(oldest[1].vbo);
            gl.deleteBuffer(oldest[1].ibo);
            this.meshes.delete(oldest[0]);
          }
        }
        this.meshLoading.delete(weapon);
        return true;
      })
      .catch(() => {
        this.meshFailed.add(weapon);
        this.meshLoading.delete(weapon);
        return false;
      });
    this.meshLoading.set(weapon, p);
    return p;
  }

  /** Load the armory backdrop (colour + depth). */
  ensureBackdrop(): Promise<boolean> {
    if (!this.gl || !this.ok || !this.bgProg) return Promise.resolve(false);
    if (this.bgTex && this.bgDepth) return Promise.resolve(true);
    if (!this.bgLoading) {
      const gl = this.gl;
      this.bgLoading = Promise.all([this.imageTexture('bg/armory.webp', gl.RGB), this.imageTexture('bg/armory_d.webp', gl.LUMINANCE)]).then(([c, d]) => {
        if (!c || !d) return false;
        this.bgTex = c;
        this.bgDepth = d;
        return true;
      });
    }
    return this.bgLoading;
  }

  // ------------------------------------------------------------ drawing

  private begin(w: number, h: number): void {
    const gl = this.gl!;
    gl.viewport(0, 0, w, h);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  }

  private bindQuad(): void {
    const gl = this.gl!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.disableVertexAttribArray(1);
    gl.disableVertexAttribArray(2);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  /** Bind atlas / pattern / noise and every per-item uniform shared by both views. */
  private skinUniforms(pr: Prog, spec: DrawSpec, atlas: Tex): void {
    const gl = this.gl!;
    const u = pr.u;
    atlas.used = ++this.clock;
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
    gl.uniform4f(u.uXf, h1, h2, rot, scale);
    gl.uniform1f(u.uWear, spec.wear);
    gl.uniform2f(u.uSeed, unit(seed ^ 0x77, p * 7 + 1), unit(seed ^ 0x99, p * 13 + 5));
    const cols = skin ? skin.colors : ['#5a5c60'];
    const accent = hexToRgb(skin?.a || cols[Math.min(1, cols.length - 1)]);
    gl.uniform3f(u.uAccent, Math.pow(accent[0] / 255, 2.2), Math.pow(accent[1] / 255, 2.2), Math.pow(accent[2] / 255, 2.2));
    const glowC = hexToRgb(cols[Math.min(1, cols.length - 1)]);
    gl.uniform3f(u.uGlowCol, glowC[0] / 255, glowC[1] / 255, glowC[2] / 255);
    const fin = FINISH[skin?.f || 'satin'];
    gl.uniform4f(u.uFin, fin[0], fin[1], fin[2], skin?.g || 0);
    gl.uniform3f(u.uL, -0.45 + (spec.lx || 0) * 0.9, 0.68 + (spec.ly || 0) * 0.7, 0.62);
    const accentGlows = Math.abs(accent[0] - glowC[0]) + Math.abs(accent[1] - glowC[1]) + Math.abs(accent[2] - glowC[2]) < 40 ? 0.7 : 0;
    gl.uniform4f(u.uKind, spec.kind ?? (WEAPONS[spec.weapon]?.kind || 0), spec.prime ? 1 : 0, skin ? 1 : 0, accentGlows);
  }

  private atlasFor(weapon: string, full: boolean): Tex | undefined {
    return this.atlases.get(this.atlasKey(weapon, full)) || (full ? this.atlases.get(this.atlasKey(weapon, false)) : undefined);
  }

  /** Draw the sprite view into the shared GL canvas; returns the source rect to blit from. */
  private render(spec: DrawSpec, w: number, h: number, full: boolean): { sx: number; sy: number; sw: number; sh: number } | null {
    const gl = this.gl;
    if (!gl || !this.ok || !this.sprite) return null;
    const atlas = this.atlasFor(spec.weapon, full);
    if (!atlas) return null;
    w = Math.min(TILE_W, Math.max(8, Math.round(w)));
    h = Math.min(TILE_H, Math.max(4, Math.round(h)));
    this.begin(w, h);
    gl.useProgram(this.sprite.p);
    this.bindQuad();
    this.skinUniforms(this.sprite, spec, atlas);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.disable(gl.SCISSOR_TEST);
    return { sx: 0, sy: TILE_H - h, sw: w, sh: h };
  }

  /** Paint a weapon sprite into a 2D canvas context at (0, 0, w, h). */
  drawTo(ctx: CanvasRenderingContext2D, spec: DrawSpec, w: number, h: number, full = true): boolean {
    const r = this.render(spec, w, h, full);
    ctx.clearRect(0, 0, w, h);
    if (!r) return false;
    ctx.drawImage(this.canvas, r.sx, r.sy, r.sw, r.sh, 0, 0, w, h);
    return true;
  }

  /** Paint the real 3D item (and optionally the armory backdrop) into a 2D canvas context. */
  drawMeshTo(ctx: CanvasRenderingContext2D, spec: DrawSpec, w: number, h: number, view: View3D): boolean {
    const gl = this.gl;
    const m = this.meshes.get(spec.weapon);
    const atlas = this.atlasFor(spec.weapon, true);
    if (!gl || !this.ok || !this.mesh || !m || !atlas) return false;
    m.used = ++this.clock;
    w = Math.min(TILE_W, Math.max(8, Math.round(w)));
    h = Math.min(TILE_H, Math.max(4, Math.round(h)));
    this.begin(w, h);

    if (view.bg && this.bgProg && this.bgTex && this.bgDepth) {
      gl.useProgram(this.bgProg.p);
      this.bindQuad();
      gl.activeTexture(gl.TEXTURE3);
      gl.bindTexture(gl.TEXTURE_2D, this.bgTex);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, this.bgDepth);
      gl.uniform2f(this.bgProg.u.uShift, -view.px * 0.022, view.py * 0.016);
      const t = view.tint || [0, 0, 0];
      gl.uniform3f(this.bgProg.u.uTint, t[0], t[1], t[2]);
      gl.uniform1f(this.bgProg.u.uAsp, Math.min(1, w / h / 2));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // orientation: bake-camera frame, spun about the item's own vertical axis, then tilted
    const [rx, ry, rz] = m.right;
    const [ux, uy, uz] = m.up;
    const [dx, dy, dz] = m.dir;
    const cs = Math.cos(view.spin);
    const sn = Math.sin(view.spin);
    // R0 (rows right / up / dir) * Ry(spin)
    const a = [
      rx * cs - rz * sn, ry, rx * sn + rz * cs,
      ux * cs - uz * sn, uy, ux * sn + uz * cs,
      dx * cs - dz * sn, dy, dx * sn + dz * cs,
    ];
    const ct = Math.cos(view.tilt);
    const st = Math.sin(view.tilt);
    // Rx(tilt) * a   (row-major 3x3)
    const R = [
      a[0], a[1], a[2],
      ct * a[3] - st * a[6], ct * a[4] - st * a[7], ct * a[5] - st * a[8],
      st * a[3] + ct * a[6], st * a[4] + ct * a[7], st * a[5] + ct * a[8],
    ];
    const cx = m.bmin[0] + m.size[0] / 2;
    const cy = m.bmin[1] + m.size[1] / 2;
    const cz = m.bmin[2] + m.size[2] / 2;
    const tanV = Math.tan((10 * Math.PI) / 180);
    const tanH = tanV * (w / h);
    const rh = 0.5 * Math.hypot(m.size[0], m.size[2]);
    const dist = Math.max((rh * 1.16) / tanH, ((m.size[1] / 2) * 0.95 + 0.3 * rh) / tanV) / view.zoom;
    const reach = 0.5 * Math.hypot(m.size[0], m.size[1], m.size[2]) * 1.2;
    const near = Math.max(1, dist - reach);
    const far = dist + reach;
    gl.useProgram(this.mesh.p);
    const u = this.mesh.u;
    this.skinUniforms(this.mesh, spec, atlas);
    gl.uniform3f(u.uBMin, m.bmin[0], m.bmin[1], m.bmin[2]);
    gl.uniform3f(u.uBSize, m.size[0], m.size[1], m.size[2]);
    // GLSL mat3 is column-major
    gl.uniformMatrix3fv(u.uRot, false, new Float32Array([R[0], R[3], R[6], R[1], R[4], R[7], R[2], R[5], R[8]]));
    gl.uniform3f(u.uShiftV,
      -(R[0] * cx + R[1] * cy + R[2] * cz),
      -(R[3] * cx + R[4] * cy + R[5] * cz),
      -(R[6] * cx + R[7] * cy + R[8] * cz) - dist);
    gl.uniform4f(u.uProj, 1 / tanH, 1 / tanV, -(far + near) / (far - near), (-2 * far * near) / (far - near));
    gl.uniform3f(u.uCamR, rx, ry, rz);
    gl.uniform3f(u.uCamU, ux, uy, uz);
    gl.uniform3f(u.uCamD, dx, dy, dz);
    gl.uniform3f(u.uCamC, m.cam[0], m.cam[1], m.cam[2]);
    gl.bindBuffer(gl.ARRAY_BUFFER, m.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, m.ibo);
    gl.enableVertexAttribArray(0);
    gl.enableVertexAttribArray(1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(0, 3, gl.UNSIGNED_SHORT, true, 10, 0);
    gl.vertexAttribPointer(1, 3, gl.BYTE, true, 10, 6);
    gl.vertexAttribPointer(2, 1, gl.UNSIGNED_BYTE, false, 10, 9);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.drawElements(gl.TRIANGLES, m.count, m.type, 0);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.SCISSOR_TEST);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(this.canvas, 0, TILE_H - h, w, h, 0, 0, w, h);
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
