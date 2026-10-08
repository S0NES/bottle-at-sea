import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  FogExp2,
  HemisphereLight,
  PointLight,
  Plane,
  MathUtils,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { Bottle } from './scene/bottle';
import { CameraRig } from './scene/camera-rig';
import { Ocean } from './scene/ocean';
import { Dust, Splash } from './scene/particles';
import { Post } from './scene/post';
import { DayCycle, type TimeMode } from './scene/daycycle';
import { Sky } from './scene/sky';
import { motion } from './motion';

const DECOR_COUNT = 6;

export class WebGLUnsupportedError extends Error {
  constructor() {
    super('WebGL 2 is not available');
    this.name = 'WebGLUnsupportedError';
  }
}

export class World {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly rig = new CameraRig();
  readonly ocean: Ocean;
  readonly cycle = new DayCycle();
  readonly sky = new Sky(this.cycle.uniforms);
  readonly dust: Dust;
  readonly splash = new Splash();
  private post: Post | null = null;

  time = 0;
  lowPower = false;
  onSplashSound: ((strength: number) => void) | null = null;
  glowTarget: Bottle | null = null;
  glowIntensity = 0;

  private readonly sunLight = new DirectionalLight(0xff9a5c, 2.4);
  private readonly moonLight = new DirectionalLight(0x9db4ff, 0);
  private readonly hemi = new HemisphereLight(0x8a78c8, 0x0b2a38, 0.75);
  private envTarget: WebGLRenderTarget | null = null;
  private envHour = -1;
  onTone: ((tone: 'day' | 'dusk' | 'night') => void) | null = null;
  private lastTone = '';
  private readonly bottles = new Set<Bottle>();
  private readonly slots: { bottle: Bottle | null; timer: number; leaving: boolean; nextTint?: number }[] = Array.from({ length: DECOR_COUNT }, (_, i) => ({ bottle: null, timer: i < 3 ? i * 2.5 : 9 + i * 3, leaving: false }));
  private readonly sentinel: Bottle;
  private readonly glow = new PointLight(0xffa24a, 0, 7, 2);
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private readonly seaPlane = new Plane(new Vector3(0, 1, 0), 0);
  private readonly seaHit = new Vector3();
  private width = 1;
  private height = 1;
  private pixelRatio = 1;
  private clock = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, lowPower: boolean) {
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    } catch {
      throw new WebGLUnsupportedError();
    }
    if (!renderer.capabilities.isWebGL2) {
      renderer.dispose();
      throw new WebGLUnsupportedError();
    }
    this.renderer = renderer;
    this.lowPower = lowPower;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.85;
    renderer.transmissionResolutionScale = lowPower ? 0.35 : 0.6;
    renderer.setClearColor(new Color(0x0a0e24), 1);

    this.ocean = new Ocean(this.cycle.uniforms, lowPower);
    this.dust = new Dust(260);

    this.scene.fog = new FogExp2(0x5b4264, 0.0085);
    this.cycle.update();
    this.rebakeEnvironment();
    this.scene.environmentIntensity = 0.9;

    this.scene.add(this.sunLight, this.moonLight, this.hemi, this.glow);
    this.scene.add(this.sky.mesh, this.ocean.mesh, this.dust.points, this.splash.points);
    this.splash.points.renderOrder = 10;

    // Keeps the glass shader program alive, so the first real bottle never stutters.
    this.sentinel = new Bottle({ tint: 0, hero: true });
    this.sentinel.root.position.set(0, -400, 0);
    this.scene.add(this.sentinel.root);

    this.resize(window.innerWidth, window.innerHeight);
    this.post = new Post(renderer, this.scene, this.rig.camera, this.width, this.height, lowPower);
    this.post.setSize(this.width, this.height, this.pixelRatio);
    this.applyQuality();

  }

  private spawnDecor(slot: number, tint?: number, live = false): void {
    const s = this.slots[slot];
    if (!s) return;
    const b = new Bottle({ tint: tint ?? Math.floor(Math.random() * 5), hero: false, scale: 3.1 });
    const z = -(8 + Math.random() * 15);
    const cam = this.rig.camera;
    const halfWidth = Math.tan(MathUtils.degToRad(cam.fov / 2)) * cam.aspect * (cam.position.z - z);
    const x = (Math.random() * 2 - 1) * halfWidth * 0.78;
    b.placeOnWater(x, z, this.time);
    b.drift.set((Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.1);
    b.opacity = 0;
    this.addBottle(b);
    this.fadeBottle(b, 1, live ? 0.7 : 3 + Math.random() * 2);
    if (live) {
      this.ocean.addRipple(x, z, 0.7);
      this.splash.emit(x, 0.1, z, 34, 2.8);
      this.onSplashSound?.(0.35);
    }
    s.bottle = b;
    s.leaving = false;
    s.timer = 14 + Math.random() * 14;
  }

  private retireDecor(slot: number, seconds: number): void {
    const s = this.slots[slot];
    const b = s?.bottle;
    if (!s || !b || s.leaving) return;
    s.leaving = true;
    this.fadeBottle(b, 0, seconds, () => {
      this.removeBottle(b);
      s.bottle = null;
      s.leaving = false;
      s.timer = 6 + Math.random() * 14;
      if (s.nextTint !== undefined) {
        const t = s.nextTint;
        s.nextTint = undefined;
        this.spawnDecor(slot, t, true);
      }
    });
  }

  announceBottle(tint: number): void {
    const free = this.slots.findIndex((s) => !s.bottle);
    if (free >= 0) {
      this.spawnDecor(free, tint, true);
      return;
    }
    const i = this.slots.findIndex((s) => !s.leaving);
    const s = this.slots[i];
    if (!s) return;
    s.nextTint = tint;
    this.retireDecor(i, 1.2);
  }

  /**
   * The drifting bottle at (or near) a screen position. Hit-testing is done in
   * screen space with a generous radius, so fingers on a phone can't miss.
   */
  pickDecor(clientX: number, clientY: number): Bottle | null {
    const cam = this.rig.camera;
    const pxPerUnitAtOne = this.height / (2 * Math.tan(MathUtils.degToRad(cam.fov / 2)));
    const v = new Vector3();
    let best: Bottle | null = null;
    let bestScore = Infinity;
    for (const s of this.slots) {
      const b = s.bottle;
      if (!b || s.leaving || b.opacity < 0.55) continue;
      v.copy(b.root.position).project(cam);
      if (v.z > 1) continue;
      const dist = b.root.position.distanceTo(cam.position);
      const sx = ((v.x + 1) / 2) * this.width;
      const sy = ((1 - v.y) / 2) * this.height;
      // Half the bottle's length on screen, but never smaller than a comfortable fingertip.
      const reach = Math.max(44, (b.root.scale.x * 0.62 * pxPerUnitAtOne) / dist);
      const d = Math.hypot(clientX - sx, clientY - sy);
      if (d <= reach && d / reach < bestScore) {
        best = b;
        bestScore = d / reach;
      }
    }
    return best;
  }

  private population = 0;
  setSeaPopulation(bottles: number): void {
    this.population = Math.max(0, Math.floor(bottles));
  }

  hoveredDecor: Bottle | null = null;

  claimDecor(b: Bottle): { x: number; z: number } {
    const origin = { x: b.root.position.x, z: b.root.position.z };
    const i = this.slots.findIndex((s) => s.bottle === b);
    if (i >= 0) this.retireDecor(i, 0.25);
    return origin;
  }

  private fadeTimers = new Map<Bottle, { to: number; rate: number }>();

  /** Frame-driven opacity fade (robust against sequences killing tweens). */
  fadeBottle(b: Bottle, to: number, seconds: number, onDone?: () => void): void {
    this.fadeTimers.set(b, { to, rate: Math.abs(to - b.opacity) / Math.max(seconds, 0.001) });
    if (onDone) this.fadeDone.set(b, onDone);
  }
  private fadeDone = new Map<Bottle, () => void>();

  addBottle(b: Bottle): void {
    b.onSplash = (x, y, z, strength) => {
      this.ocean.addRipple(x, z, strength);
      this.splash.emit(x, y + 0.05, z, Math.round(26 + 44 * strength), 2.6 + 1.6 * strength);
      this.onSplashSound?.(strength);
    };
    this.bottles.add(b);
    this.scene.add(b.root);
  }

  removeBottle(b: Bottle): void {
    this.bottles.delete(b);
    this.fadeTimers.delete(b);
    this.fadeDone.delete(b);
    if (this.glowTarget === b) this.glowTarget = null;
    b.dispose();
  }

  spawnHero(tint: number): Bottle {
    const b = new Bottle({ tint, hero: true });
    this.addBottle(b);
    return b;
  }

  hitTest(clientX: number, clientY: number, bottle: Bottle): boolean {
    this.ndc.set((clientX / this.width) * 2 - 1, -(clientY / this.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.rig.camera);
    bottle.root.updateWorldMatrix(true, true);
    return this.raycaster.intersectObject(bottle.hit, false).length > 0;
  }

  pickWater(clientX: number, clientY: number): Vector3 | null {
    this.ndc.set((clientX / this.width) * 2 - 1, -(clientY / this.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.rig.camera);
    const p = this.raycaster.ray.intersectPlane(this.seaPlane, this.seaHit);
    return p && p.distanceTo(this.rig.camera.position) < 600 ? p : null;
  }

  setLowPower(low: boolean): void {
    if (low === this.lowPower) return;
    this.lowPower = low;
    this.renderer.transmissionResolutionScale = low ? 0.35 : 0.6;
    this.ocean.setLowPower(low);
    this.post?.setLowPower(low);
    this.applyQuality();
    this.post?.setSize(this.width, this.height, this.pixelRatio);
  }

  private applyQuality(): void {
    const cap = this.lowPower ? 1 : 2;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, cap);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.dust.setDensity(this.lowPower ? 0.3 : 1);
    this.dust.setViewportHeight(this.height * this.pixelRatio);
    this.splash.setViewportHeight(this.height * this.pixelRatio);
  }

  resize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.rig.resize(this.width, this.height);
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.lowPower ? 1 : 2);
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(this.width, this.height, false);
    this.dust.setViewportHeight(this.height * this.pixelRatio);
    this.splash.setViewportHeight(this.height * this.pixelRatio);
    this.post?.setSize(this.width, this.height, this.pixelRatio);
  }

  setTimeMode(mode: TimeMode): void {
    this.cycle.setMode(mode);
    // Re-bake the glass reflections once the time-lapse has settled.
    window.setTimeout(() => this.rebakeEnvironment(), 3600);
  }

  private rebakeEnvironment(): void {
    const next = this.sky.buildEnvironment(this.renderer);
    this.scene.environment = next.texture;
    this.envTarget?.dispose();
    this.envTarget = next;
    this.envHour = this.cycle.hour;
  }

  private applyCycle(): void {
    const c = this.cycle;
    c.update();
    const u = c.uniforms;
    this.sunLight.position.copy(u.uSunDir.value).multiplyScalar(60);
    this.sunLight.color.copy(c.sunLightColor);
    this.sunLight.intensity = c.sunLightIntensity;
    this.moonLight.position.copy(u.uMoonDir.value).multiplyScalar(60);
    this.moonLight.intensity = c.moonLightIntensity;
    this.hemi.color.copy(c.hemiSky);
    this.hemi.groundColor.copy(c.hemiGround);
    this.hemi.intensity = c.hemiIntensity;
    this.renderer.toneMappingExposure = c.exposure;
    (this.scene.fog as FogExp2).color.copy(c.fogColor);
    if (c.tone !== this.lastTone) {
      this.lastTone = c.tone;
      this.onTone?.(c.tone);
    }
    // Glass reflections follow the sky; refresh them every ~10 minutes of sky time.
    if (c.mode === 'auto' && this.envHour >= 0) {
      const diff = Math.abs(((c.hour - this.envHour + 36) % 24) - 12);
      if (12 - diff > 0.17) this.rebakeEnvironment();
    }
  }

  update(dt: number): void {
    this.clock += dt;
    this.time += dt * (motion.reduced ? 0.5 : 1);
    this.applyCycle();
    this.ocean.update(this.time);
    this.sky.update(this.time);
    this.dust.update(this.time, this.cycle.dustStrength);

    for (const [b, f] of this.fadeTimers) {
      const dir = Math.sign(f.to - b.opacity);
      const next = b.opacity + dir * f.rate * dt;
      const done = dir === 0 || (dir > 0 ? next >= f.to : next <= f.to);
      b.opacity = done ? f.to : next;
      if (done) {
        this.fadeTimers.delete(b);
        const cb = this.fadeDone.get(b);
        this.fadeDone.delete(b);
        cb?.();
      }
    }

    for (const b of this.bottles) b.update(dt, this.time);
    for (const s of this.slots) {
      const b = s.bottle;
      if (!b || s.leaving) continue;
      const hovered = b === this.hoveredDecor;
      const target = hovered ? 3.45 : 3.1;
      b.root.scale.setScalar(b.root.scale.x + (target - b.root.scale.x) * Math.min(1, dt * 8));
      b.glow += ((hovered ? 2.4 : 1) - b.glow) * Math.min(1, dt * 8);
    }
    this.slots.forEach((s, i) => {
      if (!s.bottle) {
        if (i >= this.population) return;
        s.timer -= dt;
        if (s.timer <= 0) this.spawnDecor(i);
      } else if (!s.leaving) {
        if (i >= this.population) {
          this.retireDecor(i, 2);
          return;
        }
        s.timer -= dt;
        if (s.timer <= 0) this.retireDecor(i, 3);
      }
    });

    this.splash.update(dt);
    this.rig.update(dt, this.clock);

    const light = this.glow;
    if (this.glowTarget) {
      light.position.copy(this.glowTarget.root.position);
      light.position.y += 0.15;
    }
    light.intensity = this.glowTarget ? this.glowIntensity : 0;
  }

  render(dt: number): void {
    this.post?.render(dt, this.clock);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const b of [...this.bottles]) b.dispose();
    this.sentinel.dispose();
    this.bottles.clear();
    this.ocean.dispose();
    this.sky.dispose();
    this.dust.dispose();
    this.splash.dispose();
    this.rig.dispose();
    this.post?.dispose();
    this.envTarget?.dispose();
    this.cycle.dispose();
    this.renderer.dispose();
  }
}
