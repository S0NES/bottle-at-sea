import { Color, MathUtils, Vector3, type IUniform } from 'three';
import gsap from 'gsap';

type V3 = readonly [number, number, number];

interface Stop {
  e: number;
  horizonA: V3;
  horizonB: V3;
  lowA: V3;
  lowB: V3;
  mid: V3;
  top: V3;
  stars: number;
  cloudLit: V3;
  cloudShade: V3;
  glow: V3;
  sunCol: V3;
  seaDeep: V3;
  seaTeal: V3;
  exposure: number;
  sunLight: V3;
  sunI: number;
  hemiSky: V3;
  hemiGround: V3;
  hemiI: number;
}

const STOPS: readonly Stop[] = [
  {
    e: -0.32, // night
    horizonA: [0.045, 0.06, 0.15], horizonB: [0.03, 0.045, 0.12], lowA: [0.03, 0.04, 0.12], lowB: [0.025, 0.035, 0.1],
    mid: [0.015, 0.022, 0.075], top: [0.004, 0.008, 0.03], stars: 1, cloudLit: [0.16, 0.2, 0.36], cloudShade: [0.02, 0.03, 0.07],
    glow: [0.1, 0.14, 0.3], sunCol: [0.1, 0.12, 0.25], seaDeep: [0.003, 0.012, 0.035], seaTeal: [0.012, 0.055, 0.105],
    exposure: 1.05, sunLight: [0.4, 0.5, 0.9], sunI: 0, hemiSky: [0.12, 0.16, 0.35], hemiGround: [0.01, 0.03, 0.05], hemiI: 0.55,
  },
  {
    e: -0.09, // twilight
    horizonA: [0.55, 0.2, 0.22], horizonB: [0.22, 0.12, 0.3], lowA: [0.35, 0.12, 0.3], lowB: [0.15, 0.09, 0.28],
    mid: [0.08, 0.06, 0.24], top: [0.012, 0.02, 0.1], stars: 0.8, cloudLit: [0.7, 0.3, 0.4], cloudShade: [0.08, 0.06, 0.18],
    glow: [1.0, 0.4, 0.2], sunCol: [1.0, 0.45, 0.25], seaDeep: [0.006, 0.025, 0.07], seaTeal: [0.02, 0.12, 0.18],
    exposure: 0.95, sunLight: [0.9, 0.45, 0.4], sunI: 0.5, hemiSky: [0.3, 0.25, 0.55], hemiGround: [0.02, 0.07, 0.12], hemiI: 0.6,
  },
  {
    e: 0.065, // golden hour (the original dusk)
    horizonA: [0.92, 0.38, 0.16], horizonB: [0.34, 0.15, 0.32], lowA: [0.78, 0.22, 0.3], lowB: [0.4, 0.13, 0.32],
    mid: [0.19, 0.11, 0.38], top: [0.012, 0.02, 0.085], stars: 0.5, cloudLit: [0.95, 0.42, 0.34], cloudShade: [0.16, 0.1, 0.26],
    glow: [1.0, 0.42, 0.14], sunCol: [1.0, 0.8, 0.55], seaDeep: [0.012, 0.05, 0.11], seaTeal: [0.03, 0.27, 0.31],
    exposure: 0.85, sunLight: [1.0, 0.6, 0.36], sunI: 2.4, hemiSky: [0.54, 0.47, 0.78], hemiGround: [0.04, 0.16, 0.22], hemiI: 0.75,
  },
  {
    e: 0.22, // morning / late afternoon
    horizonA: [1.0, 0.72, 0.5], horizonB: [0.75, 0.6, 0.7], lowA: [0.95, 0.62, 0.6], lowB: [0.55, 0.5, 0.75],
    mid: [0.35, 0.42, 0.8], top: [0.1, 0.2, 0.55], stars: 0, cloudLit: [1.0, 0.8, 0.7], cloudShade: [0.45, 0.4, 0.6],
    glow: [1.0, 0.7, 0.4], sunCol: [1.0, 0.9, 0.7], seaDeep: [0.015, 0.08, 0.17], seaTeal: [0.04, 0.3, 0.36],
    exposure: 0.85, sunLight: [1.0, 0.85, 0.65], sunI: 2.6, hemiSky: [0.6, 0.7, 0.95], hemiGround: [0.05, 0.2, 0.28], hemiI: 0.9,
  },
  {
    e: 0.55, // midday
    horizonA: [0.86, 0.93, 1.0], horizonB: [0.7, 0.86, 1.0], lowA: [0.45, 0.72, 1.0], lowB: [0.4, 0.68, 1.0],
    mid: [0.17, 0.5, 1.0], top: [0.035, 0.22, 0.9], stars: 0, cloudLit: [1.0, 1.0, 1.0], cloudShade: [0.74, 0.8, 0.94],
    glow: [1.0, 0.95, 0.8], sunCol: [1.0, 0.97, 0.88], seaDeep: [0.012, 0.1, 0.22], seaTeal: [0.04, 0.34, 0.44],
    exposure: 0.88, sunLight: [1.0, 0.96, 0.88], sunI: 3.0, hemiSky: [0.7, 0.82, 1.0], hemiGround: [0.06, 0.25, 0.33], hemiI: 1.1,
  },
];

export type TimeMode = 'auto' | 'dawn' | 'day' | 'dusk' | 'night';
export type Tone = 'day' | 'dusk' | 'night';

export const TIME_MODES: readonly TimeMode[] = ['auto', 'dawn', 'day', 'dusk', 'night'];

const MODE_HOUR: Record<Exclude<TimeMode, 'auto'>, number> = { dawn: 6.9, day: 12.5, dusk: 18.35, night: 23.8 };

export interface SkyUniforms {
  [name: string]: IUniform;
  uTime: IUniform<number>;
  uSunDir: IUniform<Vector3>;
  uMoonDir: IUniform<Vector3>;
  uMoonStrength: IUniform<number>;
  uSunVis: IUniform<number>;
  uHorizonA: IUniform<Color>;
  uHorizonB: IUniform<Color>;
  uLowA: IUniform<Color>;
  uLowB: IUniform<Color>;
  uMid: IUniform<Color>;
  uTop: IUniform<Color>;
  uStars: IUniform<number>;
  uCloudLit: IUniform<Color>;
  uCloudShade: IUniform<Color>;
  uGlow: IUniform<Color>;
  uSunCol: IUniform<Color>;
  uSeaDeep: IUniform<Color>;
  uSeaTeal: IUniform<Color>;
}

function createUniforms(): SkyUniforms {
  const c = (): IUniform<Color> => ({ value: new Color() });
  return {
    uTime: { value: 0 },
    uSunDir: { value: new Vector3(0, 0.07, -1) },
    uMoonDir: { value: new Vector3(0, -0.5, -1) },
    uMoonStrength: { value: 0 },
    uSunVis: { value: 1 },
    uHorizonA: c(), uHorizonB: c(), uLowA: c(), uLowB: c(), uMid: c(), uTop: c(),
    uStars: { value: 1 },
    uCloudLit: c(), uCloudShade: c(), uGlow: c(), uSunCol: c(), uSeaDeep: c(), uSeaTeal: c(),
  };
}

function sunElevation(h: number): number {
  return h < 19 ? 0.5 * Math.sin((Math.PI * (h - 6)) / 13) : -0.32 * Math.sin((Math.PI * (h - 19)) / 11);
}

function moonElevation(h: number): number {
  return h >= 19 ? 0.5 * Math.sin((Math.PI * (h - 19)) / 11) : -0.3 * Math.sin((Math.PI * (h - 6)) / 13);
}

function toDir(azimuth: number, elevation: number, out: Vector3): Vector3 {
  const r = Math.sqrt(Math.max(0, 1 - elevation * elevation));
  return out.set(Math.sin(azimuth) * r, elevation, -Math.cos(azimuth) * r);
}

/** Hours in the sun's frame: [6, 30), so the night is one continuous stretch. */
function solarHour(hour: number): number {
  return hour < 6 ? hour + 24 : hour;
}

function realHour(): number {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
}

const mod24 = (h: number): number => ((h % 24) + 24) % 24;

function mixInto(target: Color, a: V3, b: V3, t: number): void {
  target.setRGB(MathUtils.lerp(a[0], b[0], t), MathUtils.lerp(a[1], b[1], t), MathUtils.lerp(a[2], b[2], t));
}

export class DayCycle {
  readonly uniforms = createUniforms();
  hour = realHour();
  mode: TimeMode = 'auto';

  sunElev = 0;
  exposure = 0.85;
  sunLightColor = new Color();
  sunLightIntensity = 0;
  moonLightIntensity = 0;
  hemiSky = new Color();
  hemiGround = new Color();
  hemiIntensity = 0.75;
  fogColor = new Color();
  dustStrength = 1;
  tone: Tone = 'dusk';

  private auto = true;
  private tween: gsap.core.Tween | null = null;
  private readonly sunDir = new Vector3();
  private readonly moonDir = new Vector3();

  constructor() {
    this.apply();
  }

  setMode(mode: TimeMode, seconds = 3.2): void {
    this.mode = mode;
    this.tween?.kill();
    this.auto = false;
    const target = mode === 'auto' ? realHour() : MODE_HOUR[mode];
    const from = this.hour;
    const forward = mod24(target - from);
    const state = { h: from };
    this.tween = gsap.to(state, {
      h: from + forward,
      duration: forward < 0.01 ? 0 : seconds,
      ease: 'power2.inOut',
      onUpdate: () => {
        this.hour = mod24(state.h);
      },
      onComplete: () => {
        this.hour = mod24(from + forward);
        this.auto = mode === 'auto';
      },
    });
  }

  update(): void {
    if (this.auto) this.hour = realHour();
    this.apply();
  }

  private apply(): void {
    const h = solarHour(this.hour);
    const e = sunElevation(h);
    const me = moonElevation(h);
    this.sunElev = e;

    const azSun = h < 19 ? MathUtils.lerp(0.5, -0.42, (h - 6) / 13) : MathUtils.lerp(-0.42, 0.5, (h - 19) / 11);
    const azMoon = h >= 19 ? MathUtils.lerp(0.5, -0.42, (h - 19) / 11) : MathUtils.lerp(-0.42, 0.5, (h - 6) / 13);
    const u = this.uniforms;
    u.uSunDir.value.copy(toDir(azSun, e, this.sunDir));
    u.uMoonDir.value.copy(toDir(azMoon, me, this.moonDir));
    u.uSunVis.value = MathUtils.smoothstep(e, -0.03, 0.0);
    u.uMoonStrength.value = MathUtils.smoothstep(me, -0.05, 0.08);

    let i = 0;
    while (i < STOPS.length - 2 && e >= STOPS[i + 1]!.e) i++;
    const a = STOPS[i]!;
    const b = STOPS[i + 1]!;
    const t = MathUtils.smoothstep(MathUtils.clamp((e - a.e) / (b.e - a.e), 0, 1), 0, 1);

    mixInto(u.uHorizonA.value, a.horizonA, b.horizonA, t);
    mixInto(u.uHorizonB.value, a.horizonB, b.horizonB, t);
    mixInto(u.uLowA.value, a.lowA, b.lowA, t);
    mixInto(u.uLowB.value, a.lowB, b.lowB, t);
    mixInto(u.uMid.value, a.mid, b.mid, t);
    mixInto(u.uTop.value, a.top, b.top, t);
    mixInto(u.uCloudLit.value, a.cloudLit, b.cloudLit, t);
    mixInto(u.uCloudShade.value, a.cloudShade, b.cloudShade, t);
    mixInto(u.uGlow.value, a.glow, b.glow, t);
    mixInto(u.uSunCol.value, a.sunCol, b.sunCol, t);
    mixInto(u.uSeaDeep.value, a.seaDeep, b.seaDeep, t);
    mixInto(u.uSeaTeal.value, a.seaTeal, b.seaTeal, t);
    u.uStars.value = MathUtils.lerp(a.stars, b.stars, t);

    this.exposure = MathUtils.lerp(a.exposure, b.exposure, t);
    mixInto(this.sunLightColor, a.sunLight, b.sunLight, t);
    this.sunLightIntensity = MathUtils.lerp(a.sunI, b.sunI, t) * u.uSunVis.value;
    this.moonLightIntensity = 0.6 * u.uMoonStrength.value * (1 - MathUtils.smoothstep(e, 0.0, 0.25));
    mixInto(this.hemiSky, a.hemiSky, b.hemiSky, t);
    mixInto(this.hemiGround, a.hemiGround, b.hemiGround, t);
    this.hemiIntensity = MathUtils.lerp(a.hemiI, b.hemiI, t);
    this.fogColor.copy(u.uHorizonB.value).lerp(u.uHorizonA.value, 0.55).multiplyScalar(0.8);
    this.dustStrength = 1 - 0.8 * MathUtils.smoothstep(e, 0.05, 0.35);
    this.tone = e > 0.3 ? 'day' : e < -0.1 ? 'night' : 'dusk';
  }

  dispose(): void {
    this.tween?.kill();
  }
}
