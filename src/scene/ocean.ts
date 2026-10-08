import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector4 } from 'three';
import vert from '../shaders/ocean.vert.glsl?raw';
import frag from '../shaders/ocean.frag.glsl?raw';
import type { SkyUniforms } from './daycycle';
import { SKY_CHUNK } from './sky';
import { waveGLSL } from './waves';

const RIPPLE_SLOTS = 4;

/**
 * Radial mesh: dense near the middle (where bottles float), sparse toward a
 * far horizon. A single centre vertex avoids a hole under the camera.
 */
function buildGeometry(rings: number, segments: number, inner: number, outer: number): BufferGeometry {
  const growth = Math.pow(outer / inner, 1 / (rings - 1));
  const verts = (rings + 1) * (segments + 1);
  const pos = new Float32Array(verts * 3);
  let v = 0;
  for (let j = 0; j <= rings; j++) {
    const r = j === 0 ? 0 : inner * Math.pow(growth, j - 1);
    for (let s = 0; s <= segments; s++) {
      const a = (s / segments) * Math.PI * 2;
      pos[v++] = Math.cos(a) * r;
      pos[v++] = 0;
      pos[v++] = Math.sin(a) * r;
    }
  }
  const idx = new Uint32Array(rings * segments * 6);
  let k = 0;
  const stride = segments + 1;
  for (let j = 0; j < rings; j++) {
    for (let s = 0; s < segments; s++) {
      const a = j * stride + s;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      idx[k++] = a;
      idx[k++] = c;
      idx[k++] = b;
      idx[k++] = b;
      idx[k++] = c;
      idx[k++] = d;
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(new BufferAttribute(idx, 1));
  return g;
}

export class Ocean {
  readonly mesh: Mesh<BufferGeometry, ShaderMaterial>;
  private readonly ripples: Vector4[] = Array.from({ length: RIPPLE_SLOTS }, () => new Vector4(0, 0, -100, 0));
  private nextRipple = 0;
  /** Wave clock; must equal the time passed to `surfaceAt`. */
  time = 0;

  constructor(skyUniforms: SkyUniforms, lowPower = false) {
    const material = new ShaderMaterial({
      vertexShader: vert.replace('// <waves> is injected here by ocean.ts (generated from waves.ts)', waveGLSL()),
      fragmentShader: `#define SKY_CLOUD_OCTAVES 3\n${frag.replace('// <sky> is injected here by ocean.ts', SKY_CHUNK)}`,
      uniforms: { ...skyUniforms, uRipples: { value: this.ripples } },
    });
    const geometry = lowPower ? buildGeometry(150, 220, 0.7, 1700) : buildGeometry(210, 320, 0.55, 1700);
    this.mesh = new Mesh(geometry, material);
    this.mesh.position.set(0, 0, -6);
    this.mesh.frustumCulled = false;
  }

  setLowPower(low: boolean): void {
    this.mesh.geometry.dispose();
    this.mesh.geometry = low ? buildGeometry(150, 220, 0.7, 1700) : buildGeometry(210, 320, 0.55, 1700);
  }

  addRipple(x: number, z: number, strength = 1): void {
    this.ripples[this.nextRipple]!.set(x, z, this.time, strength);
    this.nextRipple = (this.nextRipple + 1) % RIPPLE_SLOTS;
  }

  update(time: number): void {
    this.time = time;
    this.mesh.material.uniforms.uTime!.value = time;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
