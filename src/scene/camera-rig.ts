import { MathUtils, PerspectiveCamera, Vector3 } from 'three';
import gsap from 'gsap';
import { motion } from '../motion';

export interface Pose {
  pos: Vector3;
  look: Vector3;
  fov: number;
  bias?: number;
}

const p = (x: number, y: number, z: number): Vector3 => new Vector3(x, y, z);

export const POSES = {
  idle: { pos: p(0, 2.4, 9), look: p(-0.6, 6.4, -40), fov: 0, bias: 1 },
  write: { pos: p(0.3, 2.0, 8), look: p(1.2, 6.0, -40), fov: -3, bias: 1 },
  hold: { pos: p(0, 2.2, 8.2), look: p(0, 2.05, 5), fov: -6 },
  watch: { pos: p(0.2, 2.8, 9.5), look: p(0.8, 3.4, -10), fov: 0 },
  find: { pos: p(0, 1.0, 9), look: p(0, 0.2, 2), fov: -2 },
} as const satisfies Record<string, Pose>;

export type PoseName = keyof typeof POSES;

export class CameraRig {
  readonly camera = new PerspectiveCamera(50, 1, 0.1, 4000);
  readonly pose: Required<Pose> = { pos: POSES.idle.pos.clone(), look: POSES.idle.look.clone(), fov: 0, bias: 1 };
  private baseFov = 50;
  private readonly pointer = { x: 0, y: 0 };
  private readonly smooth = { x: 0, y: 0 };
  private gyroActive = false;
  private tween: gsap.core.Timeline | null = null;
  private readonly tmpPos = new Vector3();
  private readonly tmpLook = new Vector3();
  private readonly onPointer = (e: PointerEvent): void => {
    if (this.gyroActive) return;
    this.pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    this.pointer.y = (e.clientY / window.innerHeight) * 2 - 1;
  };
  private readonly onOrientation = (e: DeviceOrientationEvent): void => {
    if (e.gamma === null || e.beta === null) return;
    this.gyroActive = true;
    this.pointer.x = MathUtils.clamp(e.gamma / 28, -1, 1);
    this.pointer.y = MathUtils.clamp((e.beta - 50) / 30, -1, 1);
  };

  constructor() {
    this.camera.position.copy(this.pose.pos);
    window.addEventListener('pointermove', this.onPointer, { passive: true });
    if ('DeviceOrientationEvent' in window && typeof (DeviceOrientationEvent as unknown as { requestPermission?: unknown }).requestPermission !== 'function') {
      window.addEventListener('deviceorientation', this.onOrientation, { passive: true });
    }
  }

  /** iOS only exposes tilt after a permission prompt, which needs a user gesture. */
  async enableGyro(): Promise<void> {
    const ctor = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<'granted' | 'denied'> };
    if (typeof ctor.requestPermission !== 'function') return;
    try {
      if ((await ctor.requestPermission()) === 'granted') {
        window.addEventListener('deviceorientation', this.onOrientation, { passive: true });
      }
    } catch {
      /* permission is optional; pointer parallax still works */
    }
  }

  resize(width: number, height: number): void {
    const aspect = width / height;
    this.camera.aspect = aspect;
    // Portrait screens need a taller field of view to keep the scene readable.
    this.baseFov = aspect >= 1 ? 50 : MathUtils.lerp(66, 50, MathUtils.clamp((aspect - 0.45) / 0.55, 0, 1));
    this.camera.fov = this.baseFov + this.pose.fov;
    this.camera.updateProjectionMatrix();
  }

  get isPortrait(): boolean {
    return this.camera.aspect < 1.1;
  }

  flyTo(target: PoseName | Pose, seconds: number, ease = 'power2.inOut'): gsap.core.Timeline {
    const t = typeof target === 'string' ? POSES[target] : target;
    this.tween?.kill();
    const duration = motion.reduced ? Math.min(seconds, 0.25) : seconds;
    this.tween = gsap
      .timeline()
      .to(this.pose.pos, { x: t.pos.x, y: t.pos.y, z: t.pos.z, duration, ease }, 0)
      .to(this.pose.look, { x: t.look.x, y: t.look.y, z: t.look.z, duration, ease }, 0)
      .to(this.pose, { fov: t.fov, bias: 'bias' in t ? t.bias : 0, duration, ease }, 0);
    return this.tween;
  }

  update(dt: number, time: number): void {
    const k = 1 - Math.exp(-dt * 3);
    this.smooth.x += (this.pointer.x - this.smooth.x) * k;
    this.smooth.y += (this.pointer.y - this.smooth.y) * k;

    const m = motion.reduced ? 0.15 : 1;
    const drift = this.tmpPos.set(
      Math.sin(time * 0.21) * 0.35 + Math.sin(time * 0.067) * 0.25,
      Math.sin(time * 0.17) * 0.12,
      Math.sin(time * 0.13) * 0.3,
    );
    const sx = this.smooth.x * (motion.reduced ? 0.25 : 1);
    const sy = this.smooth.y * (motion.reduced ? 0.25 : 1);

    this.camera.position.copy(this.pose.pos).addScaledVector(drift, m);
    this.camera.position.x += sx * 0.5;
    this.camera.position.y += -sy * 0.2;

    this.tmpLook.copy(this.pose.look);
    if (this.isPortrait) this.tmpLook.x -= 8 * this.pose.bias;
    this.tmpLook.x += sx * 2.4;
    this.tmpLook.y += -sy * 1.2 + Math.sin(time * 0.14) * 0.25 * m;
    this.camera.lookAt(this.tmpLook);

    const fov = this.baseFov + this.pose.fov;
    if (Math.abs(fov - this.camera.fov) > 0.001) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  dispose(): void {
    this.tween?.kill();
    window.removeEventListener('pointermove', this.onPointer);
    window.removeEventListener('deviceorientation', this.onOrientation);
  }
}
