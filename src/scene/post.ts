import {
  HalfFloatType,
  Vector2,
  WebGLRenderTarget,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const FilmShader = {
  name: 'FilmVignetteShader',
  uniforms: {
    tDiffuse: { value: null as unknown },
    uTime: { value: 0 },
    uVignette: { value: 0.55 },
    uGrain: { value: 0.05 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uVignette;
    uniform float uGrain;
    varying vec2 vUv;
    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 q = vUv - 0.5;
      q.x *= 1.0;
      float v = smoothstep(0.85, 0.2, length(q) * 1.15);
      c.rgb *= mix(1.0 - uVignette, 1.0, v);
      float g = hash(gl_FragCoord.xy + fract(uTime) * 91.7) - 0.5;
      c.rgb += g * uGrain * (0.6 + 0.4 * (1.0 - dot(c.rgb, vec3(0.333))));
      gl_FragColor = vec4(c.rgb, 1.0);
    }`,
};

export class Post {
  private composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;
  private readonly film: ShaderPass;
  private readonly output: OutputPass;
  private readonly renderPass: RenderPass;
  private samples: number;

  constructor(
    renderer: WebGLRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    width: number,
    height: number,
    lowPower: boolean,
  ) {
    this.samples = lowPower ? 0 : 4;
    const target = new WebGLRenderTarget(width, height, { type: HalfFloatType, samples: this.samples });
    this.composer = new EffectComposer(renderer, target);
    this.renderPass = new RenderPass(scene, camera);
    this.bloom = new UnrealBloomPass(new Vector2(width, height), 0.45, 0.8, 1.05);
    this.bloom.enabled = !lowPower;
    this.output = new OutputPass();
    this.film = new ShaderPass(FilmShader);
    this.composer.addPass(this.renderPass);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.film);
  }

  setLowPower(low: boolean): void {
    this.bloom.enabled = !low;
    const samples = low ? 0 : 4;
    if (samples !== this.samples) {
      this.samples = samples;
      for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
        rt.samples = samples;
        rt.dispose();
      }
    }
  }

  setSize(width: number, height: number, pixelRatio: number): void {
    this.composer.setPixelRatio(pixelRatio);
    this.composer.setSize(width, height);
  }

  render(dt: number, time: number): void {
    this.film.uniforms.uTime!.value = time;
    this.composer.render(dt);
  }

  setGrain(amount: number, vignette: number): void {
    this.film.uniforms.uGrain!.value = amount;
    this.film.uniforms.uVignette!.value = vignette;
  }

  dispose(): void {
    this.composer.dispose();
    this.bloom.dispose();
    this.output.dispose();
    this.film.dispose();
    this.renderPass.dispose();
  }
}
