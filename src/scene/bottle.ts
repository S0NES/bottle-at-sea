import {
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  SplineCurve,
  TorusGeometry,
  Vector2,
  Vector3,
  type Material,
} from 'three';
import { makeSurfaceSample, surfaceAt } from './waves';

export interface Tint {
  name: string;
  css: string;
  glass: number;
  attenuation: number;
  attenuationDistance: number;
}

export const TINTS: readonly Tint[] = [
  { name: 'Clear', css: '#d9f2ff', glass: 0xf2fbff, attenuation: 0xdff3ff, attenuationDistance: 4 },
  { name: 'Amber', css: '#e59a35', glass: 0xf0b25a, attenuation: 0xd9822a, attenuationDistance: 1.1 },
  { name: 'Sea green', css: '#3fbf92', glass: 0x7fe0b8, attenuation: 0x2fae80, attenuationDistance: 1.1 },
  { name: 'Cobalt', css: '#4673ff', glass: 0x86a4ff, attenuation: 0x3560ee, attenuationDistance: 1.0 },
  { name: 'Violet', css: '#a875ff', glass: 0xc3a2ff, attenuation: 0x9560f0, attenuationDistance: 1.0 },
];

export type BottleMode = 'float' | 'ballistic' | 'free';

export interface BottleOptions {
  tint: number;
  /** Hero bottles use real transmission/refraction; decorative ones are cheap. */
  hero: boolean;
  scale?: number;
}

export const FLOAT_TILT = Math.PI / 2 - 0.3;
const SINK = 0.075;
const SCROLL_REST_Y = -0.15;

interface SharedGeometry {
  body: LatheGeometry;
  cork: CylinderGeometry;
  scroll: CylinderGeometry;
  ribbon: TorusGeometry;
  hit: SphereGeometry;
}

let shared: SharedGeometry | null = null;
let sharedRefs = 0;

function acquireGeometry(): SharedGeometry {
  if (!shared) {
    const profile = new SplineCurve(
      [
        [0, -0.5], [0.07, -0.499], [0.13, -0.488], [0.162, -0.46], [0.172, -0.41], [0.173, -0.3], [0.173, 0.02],
        [0.168, 0.1], [0.15, 0.17], [0.115, 0.225], [0.076, 0.268], [0.055, 0.31], [0.048, 0.36], [0.047, 0.42],
        [0.052, 0.46], [0.061, 0.482], [0.059, 0.503], [0.03, 0.506], [0, 0.506],
      ].map(([r, y]) => new Vector2(r, y)),
    ).getPoints(90);
    shared = {
      body: new LatheGeometry(profile, 44),
      cork: new CylinderGeometry(0.05, 0.041, 0.12, 20),
      scroll: new CylinderGeometry(0.031, 0.031, 0.42, 18),
      ribbon: new TorusGeometry(0.035, 0.006, 8, 20),
      hit: new SphereGeometry(0.62, 12, 8),
    };
  }
  sharedRefs++;
  return shared;
}

function releaseGeometry(): void {
  sharedRefs--;
  if (sharedRefs <= 0 && shared) {
    shared.body.dispose();
    shared.cork.dispose();
    shared.scroll.dispose();
    shared.ribbon.dispose();
    shared.hit.dispose();
    shared = null;
    sharedRefs = 0;
  }
}

interface FadeMaterial {
  material: Material & { opacity: number };
  base: number;
  /** Opaque at full opacity so it shows through the glass transmission pass. */
  opaqueWhenSolid: boolean;
}

const _sample = makeSurfaceSample();
const _n = new Vector3();
const _f = new Vector3();
const _r = new Vector3();
const _m = new Matrix4();
const _q = new Quaternion();
const _dq = new Quaternion();
const _axis = new Vector3();

export class Bottle {
  readonly root = new Group();
  readonly tilt = new Group();
  readonly body: Mesh;
  readonly cork: Mesh;
  readonly scroll = new Group();
  readonly hit: Mesh;
  readonly isHero: boolean;

  mode: BottleMode = 'free';
  readonly velocity = new Vector3();
  readonly spin = new Vector3();
  readonly drift = new Vector2();
  heading = 0;
  onSplash: ((x: number, y: number, z: number, strength: number) => void) | null = null;
  glow = 1;

  private vy = 0;
  private readonly seed = Math.random() * 100;
  private readonly fades: FadeMaterial[] = [];
  private readonly scrollMaterial: MeshStandardMaterial;
  private readonly materials: Material[] = [];
  private opacityValue = 1;
  private disposed = false;

  constructor(opts: BottleOptions) {
    const geo = acquireGeometry();
    this.isHero = opts.hero;
    const tint = TINTS[opts.tint] ?? TINTS[0]!;

    const glass = opts.hero
      ? new MeshPhysicalMaterial({
          color: new Color(tint.glass),
          transmission: 1,
          thickness: 0.09,
          ior: 1.5,
          roughness: 0.04,
          metalness: 0,
          clearcoat: 1,
          clearcoatRoughness: 0.03,
          attenuationColor: new Color(tint.attenuation),
          attenuationDistance: tint.attenuationDistance,
          envMapIntensity: 1.4,
          transparent: true,
          side: DoubleSide,
        })
      : new MeshPhysicalMaterial({
          color: new Color(tint.glass).multiplyScalar(0.72),
          roughness: 0.06,
          metalness: 0,
          clearcoat: 1,
          envMapIntensity: 1.6,
          transparent: true,
          opacity: 0.88,
          depthWrite: false,
          emissive: new Color(tint.attenuation),
          emissiveIntensity: 0.32,
        });
    glass.fog = !opts.hero;
    this.fades.push({ material: glass, base: glass.opacity, opaqueWhenSolid: false });

    const corkMat = new MeshStandardMaterial({ color: 0xb08457, roughness: 0.95 });
    corkMat.fog = !opts.hero;
    this.fades.push({ material: corkMat, base: 1, opaqueWhenSolid: true });

    this.scrollMaterial = new MeshStandardMaterial({
      color: 0xf3e0b0,
      emissive: new Color(0xffa24a),
      emissiveIntensity: 1.3,
      roughness: 0.8,
    });
    this.scrollMaterial.fog = !opts.hero;
    this.fades.push({ material: this.scrollMaterial, base: 1, opaqueWhenSolid: true });

    const ribbonMat = new MeshStandardMaterial({ color: 0x9a2f2f, roughness: 0.6 });
    ribbonMat.fog = !opts.hero;
    this.fades.push({ material: ribbonMat, base: 1, opaqueWhenSolid: true });

    const hitMat = new MeshBasicMaterial({ visible: false });
    this.materials.push(glass, corkMat, this.scrollMaterial, ribbonMat, hitMat);

    this.body = new Mesh(geo.body, glass);
    this.cork = new Mesh(geo.cork, corkMat);
    this.cork.position.y = 0.495;

    const roll = new Mesh(geo.scroll, this.scrollMaterial);
    const ribbon = new Mesh(geo.ribbon, ribbonMat);
    ribbon.rotation.x = Math.PI / 2;
    this.scroll.add(roll, ribbon);
    this.scroll.position.y = SCROLL_REST_Y;
    this.scroll.rotation.z = 0.05;

    this.hit = new Mesh(geo.hit, hitMat);

    this.tilt.add(this.body, this.cork, this.scroll, this.hit);
    this.tilt.rotation.x = FLOAT_TILT;
    this.root.add(this.tilt);
    this.root.scale.setScalar(opts.scale ?? 1);
    this.heading = Math.random() * Math.PI * 2;
  }

  get opacity(): number {
    return this.opacityValue;
  }

  set opacity(o: number) {
    this.opacityValue = o;
    for (const f of this.fades) {
      f.material.opacity = f.base * o;
      if (f.opaqueWhenSolid) {
        const transparent = o < 0.999;
        if (f.material.transparent !== transparent) {
          f.material.transparent = transparent;
          f.material.needsUpdate = true;
        }
      }
    }
    this.root.visible = o > 0.003;
  }

  restScroll(): void {
    this.scroll.position.set(0, SCROLL_REST_Y, 0);
    this.scroll.rotation.set(0, 0, 0.05);
  }

  get scrollRestY(): number {
    return SCROLL_REST_Y;
  }

  placeOnWater(x: number, z: number, time: number): void {
    surfaceAt(x, z, time, _sample);
    this.root.position.set(x, _sample.y - SINK * this.root.scale.x, z);
    this.vy = 0;
    this.mode = 'float';
  }

  launch(velocity: Vector3, spin: Vector3): void {
    this.velocity.copy(velocity);
    this.spin.copy(spin);
    this.mode = 'ballistic';
  }

  release(): void {
    this.velocity.set(0, 0, 0);
    this.spin.set(0, 0, 0);
    this.mode = 'ballistic';
  }

  update(dt: number, time: number): void {
    const flicker = 1 + 0.1 * Math.sin(time * 3.1 + this.seed) + 0.05 * Math.sin(time * 7.3 + this.seed * 2);
    this.scrollMaterial.emissiveIntensity = 1.3 * this.glow * flicker;

    const pos = this.root.position;
    const scale = this.root.scale.x;

    if (this.mode === 'ballistic') {
      this.velocity.y -= 9.8 * dt;
      pos.addScaledVector(this.velocity, dt);
      const w = this.spin.length();
      if (w > 1e-4) {
        _axis.copy(this.spin).multiplyScalar(1 / w);
        _dq.setFromAxisAngle(_axis, w * dt);
        this.root.quaternion.premultiply(_dq);
      }
      surfaceAt(pos.x, pos.z, time, _sample);
      if (pos.y <= _sample.y && this.velocity.y < 0) {
        pos.y = _sample.y;
        this.vy = this.velocity.y * 0.22;
        this.drift.set(this.velocity.x * 0.1, this.velocity.z * 0.1);
        this.mode = 'float';
        this.onSplash?.(pos.x, _sample.y, pos.z, Math.min(1.3, Math.abs(this.velocity.y) / 7));
      }
      return;
    }

    if (this.mode !== 'float') return;

    pos.x += this.drift.x * dt;
    pos.z += this.drift.y * dt;
    surfaceAt(pos.x, pos.z, time, _sample);
    const target = _sample.y - SINK * scale;
    this.vy += ((target - pos.y) * 46 - this.vy * 6.5) * dt;
    pos.y += this.vy * dt;

    const h = this.heading + Math.sin(time * 0.27 + this.seed) * 0.35;
    _n.set(_sample.nx, _sample.ny, _sample.nz);
    _f.set(Math.sin(h), 0, Math.cos(h));
    _f.addScaledVector(_n, -_f.dot(_n)).normalize();
    _r.crossVectors(_n, _f);
    _m.makeBasis(_r, _n, _f);
    _q.setFromRotationMatrix(_m);
    this.root.quaternion.slerp(_q, 1 - Math.exp(-dt * 5));
    this.tilt.rotation.x += (FLOAT_TILT - this.tilt.rotation.x) * (1 - Math.exp(-dt * 5));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const m of this.materials) m.dispose();
    this.root.removeFromParent();
    releaseGeometry();
  }
}
