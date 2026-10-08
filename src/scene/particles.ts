import { AdditiveBlending, BufferAttribute, BufferGeometry, Points, ShaderMaterial } from 'three';

const dustVert = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform float uScale;
varying float vTw;
varying float vSeed;
void main() {
  vec3 p = position;
  p.x += sin(uTime * 0.21 + aSeed * 20.0) * 1.1;
  p.y += sin(uTime * 0.33 + aSeed * 13.0) * 0.45 + sin(uTime * 0.11 + aSeed * 7.0) * 0.3;
  p.z += cos(uTime * 0.17 + aSeed * 31.0) * 1.1;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uScale * (0.45 + aSeed * 1.0) / -mv.z, 1.0, 22.0);
  vTw = 0.5 + 0.5 * sin(uTime * (0.7 + aSeed * 1.8) + aSeed * 50.0);
  vSeed = aSeed;
}`;

const dustFrag = /* glsl */ `
uniform float uStrength;
varying float vTw;
varying float vSeed;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  a *= a;
  vec3 c = mix(vec3(1.0, 0.78, 0.45), vec3(1.0, 0.55, 0.65), step(0.7, vSeed));
  gl_FragColor = vec4(c * (0.5 + vTw), a * (0.25 + 0.75 * vTw) * uStrength);
}`;

export class Dust {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  private readonly max: number;

  constructor(count: number) {
    this.max = count;
    const pos = new Float32Array(count * 3);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 34;
      pos[i * 3 + 1] = 0.35 + Math.pow(Math.random(), 1.6) * 6.5;
      pos[i * 3 + 2] = 12 - Math.random() * 46;
      seed[i] = Math.random();
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(pos, 3));
    g.setAttribute('aSeed', new BufferAttribute(seed, 1));
    const m = new ShaderMaterial({
      vertexShader: dustVert,
      fragmentShader: dustFrag,
      uniforms: { uTime: { value: 0 }, uScale: { value: 40 }, uStrength: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(g, m);
    this.points.frustumCulled = false;
  }

  setDensity(fraction: number): void {
    this.points.geometry.setDrawRange(0, Math.max(1, Math.floor(this.max * fraction)));
  }

  setViewportHeight(px: number): void {
    this.points.material.uniforms.uScale!.value = px * 0.055;
  }

  update(time: number, strength = 1): void {
    this.points.material.uniforms.uTime!.value = time;
    this.points.material.uniforms.uStrength!.value = strength;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}

const splashVert = /* glsl */ `
attribute float aAlpha;
attribute float aSize;
uniform float uScale;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uScale * aSize / -mv.z, 1.0, 40.0);
  vAlpha = aAlpha;
}`;

const splashFrag = /* glsl */ `
varying float vAlpha;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d) * vAlpha;
  gl_FragColor = vec4(vec3(1.0, 0.86, 0.72) * 1.5, a);
}`;

export class Splash {
  readonly points: Points<BufferGeometry, ShaderMaterial>;
  private readonly max: number;
  private readonly px: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly age: Float32Array;
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private cursor = 0;

  constructor(max = 220) {
    this.max = max;
    this.px = new Float32Array(max * 3).fill(0);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max).fill(0);
    this.age = new Float32Array(max).fill(1);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    for (let i = 0; i < max; i++) this.px[i * 3 + 1] = -1000;
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(this.px, 3).setUsage(35048));
    g.setAttribute('aAlpha', new BufferAttribute(this.alpha, 1).setUsage(35048));
    g.setAttribute('aSize', new BufferAttribute(this.size, 1));
    const m = new ShaderMaterial({
      vertexShader: splashVert,
      fragmentShader: splashFrag,
      uniforms: { uScale: { value: 40 } },
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.points = new Points(g, m);
    this.points.frustumCulled = false;
  }

  setViewportHeight(px: number): void {
    this.points.material.uniforms.uScale!.value = px * 0.05;
  }

  emit(x: number, y: number, z: number, count: number, speed = 3.2, size = 0.07): void {
    for (let n = 0; n < count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      const horizontal = speed * (0.25 + 0.75 * r);
      this.px[i * 3] = x + Math.cos(a) * 0.08;
      this.px[i * 3 + 1] = y;
      this.px[i * 3 + 2] = z + Math.sin(a) * 0.08;
      this.vel[i * 3] = Math.cos(a) * horizontal;
      this.vel[i * 3 + 1] = speed * (0.9 + Math.random() * 1.1);
      this.vel[i * 3 + 2] = Math.sin(a) * horizontal;
      this.life[i] = 0.7 + Math.random() * 0.8;
      this.age[i] = 0;
      this.size[i] = size * (0.5 + Math.random());
    }
    this.points.geometry.getAttribute('aSize').needsUpdate = true;
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      const life = this.life[i]!;
      if (life <= 0 || this.age[i]! >= life) {
        this.alpha[i] = 0;
        this.px[i * 3 + 1] = -1000;
        continue;
      }
      this.age[i]! += dt;
      this.vel[i * 3 + 1]! -= 9.8 * dt;
      this.px[i * 3]! += this.vel[i * 3]! * dt;
      this.px[i * 3 + 1]! += this.vel[i * 3 + 1]! * dt;
      this.px[i * 3 + 2]! += this.vel[i * 3 + 2]! * dt;
      const k = 1 - this.age[i]! / life;
      this.alpha[i] = k * k;
    }
    this.points.geometry.getAttribute('position').needsUpdate = true;
    this.points.geometry.getAttribute('aAlpha').needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.points.material.dispose();
  }
}
