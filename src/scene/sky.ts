import {
  BackSide,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import skyChunk from '../shaders/sky.glsl?raw';
import vert from '../shaders/sky.vert.glsl?raw';
import frag from '../shaders/sky.frag.glsl?raw';
import type { SkyUniforms } from './daycycle';

export const SKY_CHUNK = skyChunk;

export class Sky {
  readonly mesh: Mesh<SphereGeometry, ShaderMaterial>;

  constructor(private readonly uniforms: SkyUniforms) {
    const material = new ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag.replace('// <sky> is injected here by sky.ts', skyChunk),
      uniforms: { ...uniforms },
      side: BackSide,
      depthWrite: false,
    });
    this.mesh = new Mesh(new SphereGeometry(1, 48, 24), material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
  }

  update(time: number): void {
    this.uniforms.uTime.value = time;
  }

  buildEnvironment(renderer: WebGLRenderer): WebGLRenderTarget {
    const envScene = new Scene();
    const material = this.mesh.material.clone();
    material.uniforms.uTime = { value: 6 };
    const dome = new Mesh(this.mesh.geometry, material);
    dome.frustumCulled = false;
    envScene.add(dome);
    const pmrem = new PMREMGenerator(renderer);
    const target = pmrem.fromScene(envScene, 0.02);
    pmrem.dispose();
    material.dispose();
    return target;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
