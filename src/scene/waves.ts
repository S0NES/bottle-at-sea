/**
 * Gerstner waves: the single source of truth for the ocean surface.
 * The GLSL used by the ocean shader is generated from the same table, and
 * `surfaceAt` evaluates the same maths on the CPU so objects float on the
 * exact surface that is drawn.
 */

interface WaveDef {
  dir: readonly [number, number];
  wavelength: number;
  /** k * amplitude, 0..1. The sum across waves stays well below 1 (no loops). */
  steepness: number;
}

export const WAVES: readonly WaveDef[] = [
  { dir: [0.18, 1.0], wavelength: 24, steepness: 0.14 },
  { dir: [-0.38, 1.0], wavelength: 12.5, steepness: 0.13 },
  { dir: [0.75, 0.85], wavelength: 6.4, steepness: 0.11 },
  { dir: [-0.9, 0.45], wavelength: 3.3, steepness: 0.07 },
];

const GRAVITY = 9.8;
const SPEED_SCALE = 0.33;

interface Prepared {
  dx: number;
  dz: number;
  k: number;
  s: number;
  w: number;
  a: number;
}

const PREPARED: readonly Prepared[] = WAVES.map((w) => {
  const len = Math.hypot(w.dir[0], w.dir[1]);
  const k = (Math.PI * 2) / w.wavelength;
  return {
    dx: w.dir[0] / len,
    dz: w.dir[1] / len,
    k,
    s: w.steepness,
    w: Math.sqrt(GRAVITY * k) * SPEED_SCALE,
    a: w.steepness / k,
  };
});

export interface SurfaceSample {
  y: number;
  nx: number;
  ny: number;
  nz: number;
}

export function waveGLSL(): string {
  const f = (n: number): string => n.toFixed(6);
  const vec2s = PREPARED.map((p) => `vec2(${f(p.dx)}, ${f(p.dz)})`).join(', ');
  const floats = (pick: (p: Prepared) => number): string => PREPARED.map((p) => f(pick(p))).join(', ');
  return /* glsl */ `
#define WAVE_COUNT ${PREPARED.length}
const vec2 WAVE_D[WAVE_COUNT] = vec2[WAVE_COUNT](${vec2s});
const float WAVE_K[WAVE_COUNT] = float[WAVE_COUNT](${floats((p) => p.k)});
const float WAVE_S[WAVE_COUNT] = float[WAVE_COUNT](${floats((p) => p.s)});
const float WAVE_W[WAVE_COUNT] = float[WAVE_COUNT](${floats((p) => p.w)});

void gerstner(vec2 p0, float t, out vec3 disp, out vec3 normal, out float crest) {
  disp = vec3(0.0);
  vec3 px = vec3(1.0, 0.0, 0.0);
  vec3 pz = vec3(0.0, 0.0, 1.0);
  float cr = 0.0;
  float total = 0.0;
  for (int i = 0; i < WAVE_COUNT; i++) {
    vec2 d = WAVE_D[i];
    float k = WAVE_K[i];
    float s = WAVE_S[i];
    float f = k * dot(d, p0) - WAVE_W[i] * t;
    float sn = sin(f);
    float cs = cos(f);
    float a = s / k;
    disp += vec3(d.x * a * cs, a * sn, d.y * a * cs);
    px += vec3(-d.x * d.x * s * sn, d.x * s * cs, -d.x * d.y * s * sn);
    pz += vec3(-d.x * d.y * s * sn, d.y * s * cs, -d.y * d.y * s * sn);
    cr += s * sn;
    total += s;
  }
  normal = normalize(cross(pz, px));
  crest = cr / total;
}
`;
}

function evalAt(
  x0: number,
  z0: number,
  t: number,
  out: { dx: number; dy: number; dz: number; nx: number; ny: number; nz: number },
): void {
  let dx = 0;
  let dy = 0;
  let dz = 0;
  let pxx = 1, pxy = 0, pxz = 0;
  let pzx = 0, pzy = 0, pzz = 1;
  for (const p of PREPARED) {
    const f = p.k * (p.dx * x0 + p.dz * z0) - p.w * t;
    const sn = Math.sin(f);
    const cs = Math.cos(f);
    dx += p.dx * p.a * cs;
    dy += p.a * sn;
    dz += p.dz * p.a * cs;
    pxx -= p.dx * p.dx * p.s * sn;
    pxy += p.dx * p.s * cs;
    pxz -= p.dx * p.dz * p.s * sn;
    pzx -= p.dx * p.dz * p.s * sn;
    pzy += p.dz * p.s * cs;
    pzz -= p.dz * p.dz * p.s * sn;
  }
  const nx = pzy * pxz - pzz * pxy;
  const ny = pzz * pxx - pzx * pxz;
  const nz = pzx * pxy - pzy * pxx;
  const inv = 1 / Math.hypot(nx, ny, nz);
  out.dx = dx;
  out.dy = dy;
  out.dz = dz;
  out.nx = nx * inv;
  out.ny = ny * inv;
  out.nz = nz * inv;
}

const scratch = { dx: 0, dy: 0, dz: 0, nx: 0, ny: 1, nz: 0 };

/**
 * Surface height and normal above world position (x, z). Gerstner waves move
 * points horizontally too, so we invert the displacement with a few
 * fixed-point iterations to find which rest point lands under (x, z).
 */
export function surfaceAt(x: number, z: number, t: number, out: SurfaceSample): SurfaceSample {
  let x0 = x;
  let z0 = z;
  for (let i = 0; i < 4; i++) {
    evalAt(x0, z0, t, scratch);
    x0 = x - scratch.dx;
    z0 = z - scratch.dz;
  }
  evalAt(x0, z0, t, scratch);
  out.y = scratch.dy;
  out.nx = scratch.nx;
  out.ny = scratch.ny;
  out.nz = scratch.nz;
  return out;
}

export function makeSurfaceSample(): SurfaceSample {
  return { y: 0, nx: 0, ny: 1, nz: 0 };
}
