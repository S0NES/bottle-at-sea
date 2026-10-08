import gsap from 'gsap';
import { Euler, Quaternion, Vector3, type Material } from 'three';
import type { SeaAudio } from './audio';
import { motion } from './motion';
import type { Bottle } from './scene/bottle';
import { surfaceAt, makeSurfaceSample } from './scene/waves';
import type { World } from './world';

export interface SeqContext {
  world: World;
  audio: SeaAudio;
}

const D = (s: number): number => motion.d(s);

/** Resolves when a GSAP timeline finishes (timelines are thenables, so avoid awaiting them directly). */
function finished(tl: gsap.core.Timeline): Promise<void> {
  return new Promise((resolve) => {
    tl.eventCallback('onComplete', () => resolve());
  });
}

function sleep(seconds: number): Promise<void> {
  return new Promise((resolve) => {
    gsap.delayedCall(seconds, resolve);
  });
}

function landing(b: Bottle): Promise<void> {
  return new Promise((resolve) => {
    const orig = b.onSplash;
    b.onSplash = (x, y, z, s) => {
      b.onSplash = orig;
      orig?.(x, y, z, s);
      resolve();
    };
  });
}

export function killBottleTweens(b: Bottle): void {
  gsap.killTweensOf([b.root.position, b.root.scale, b.root.rotation, b.tilt.rotation, b.scroll.position, b.scroll.rotation, b.cork.position, b.cork.rotation, b.drift]);
}

/** Puts the scroll in, then the cork. The bottle is assumed upright and held. */
async function loadBottle(ctx: SeqContext, b: Bottle, quick: boolean): Promise<void> {
  const { world, audio } = ctx;
  const k = quick ? 0.6 : 1;
  b.opacity = Math.max(b.opacity, 0.001); // re-applies fade state so a reused cork/scroll is visible again
  b.scroll.position.set(0.05, 0.95, 0);
  b.scroll.rotation.set(0, 0, 0.5);
  b.cork.position.set(0, 1.05, 0);
  b.cork.rotation.set(0, 0, 0.4);
  world.glowTarget = b;

  const tl = gsap.timeline();
  tl.to(world, { glowIntensity: 5, duration: D(0.9 * k), ease: 'power2.out' }, 0)
    .add(() => audio.rustle(), 0.3 * k)
    .to(b.scroll.position, { x: 0, y: b.scrollRestY, duration: D(1.4 * k), ease: 'power2.inOut' }, 0.3 * k)
    .to(b.scroll.rotation, { z: 0.05, duration: D(1.4 * k), ease: 'power2.inOut' }, 0.3 * k)
    .to(world, { glowIntensity: 2.6, duration: D(0.8 * k) }, 1.7 * k)
    .to(b.cork.position, { y: 0.495, duration: D(0.6 * k), ease: 'power2.in' }, 1.9 * k)
    .to(b.cork.rotation, { z: 0, duration: D(0.6 * k), ease: 'power2.out' }, 1.9 * k)
    .add(() => audio.cork(), 2.45 * k)
    .to(b.root.position, { y: '-=0.05', duration: D(0.12), yoyo: true, repeat: 1, ease: 'sine.inOut' }, 2.45 * k);
  await finished(tl);
}

/** Wind-up, throw, splash. Resolves shortly after the bottle lands; the fade-out carries on by itself. */
async function hurl(ctx: SeqContext, b: Bottle): Promise<void> {
  const { world } = ctx;
  const sample = makeSurfaceSample();

  const windUp = gsap.timeline();
  windUp
    .to(b.root.rotation, { x: -0.55, z: 0.1, duration: D(0.55), ease: 'power2.out' }, 0)
    .to(b.root.position, { z: '+=0.55', y: '+=0.18', duration: D(0.55), ease: 'power2.out' }, 0)
    .to(b.root.position, { z: '-=0.3', y: '+=0.1', duration: D(0.18), ease: 'power3.in' }, D(0.55));
  await finished(windUp);

  world.rig.flyTo('watch', D(2.4), 'power2.out');

  const flight = motion.reduced ? 1.1 : 2.0;
  const target = new Vector3(1.1, 0, -11.5);
  surfaceAt(target.x, target.z, world.time + flight, sample);
  const from = b.root.position;
  const g = 9.8;
  const v = new Vector3(
    (target.x - from.x) / flight,
    (sample.y - from.y + 0.5 * g * flight * flight) / flight,
    (target.z - from.z) / flight,
  );
  b.heading = Math.PI; // neck points away from the camera once it floats
  const landed = landing(b);
  b.launch(v, motion.reduced ? new Vector3() : new Vector3(-5.5, 0.4, 2.2));
  await landed;

  gsap.to(b.drift, { x: 0.28, y: -1.15, duration: D(7), ease: 'power1.in' });
  gsap.to(world, {
    glowIntensity: 0,
    duration: D(1.6),
    onComplete: () => {
      if (world.glowTarget === b) world.glowTarget = null;
    },
  });
  gsap.delayedCall(D(3.4), () => world.fadeBottle(b, 0, D(3.2), () => world.removeBottle(b)));
  await sleep(D(1.0));
}

export async function throwSequence(ctx: SeqContext, tint: number): Promise<void> {
  const { world } = ctx;
  const b = world.spawnHero(tint);
  b.mode = 'free';
  b.tilt.rotation.x = 0;
  b.root.position.set(0.02, 2.0, 5.4);
  b.root.rotation.set(0, 0, 0.1);
  b.opacity = 0;
  world.glowTarget = b;
  world.glowIntensity = 0;

  world.rig.flyTo('hold', D(1.5));
  world.fadeBottle(b, 1, D(0.9));
  await sleep(D(0.9));
  await loadBottle(ctx, b, false);
  await hurl(ctx, b);
}

export function arriveSequence(
  ctx: SeqContext,
  tint: number,
  origin?: { x: number; z: number },
): { bottle: Bottle; arrived: Promise<void> } {
  const { world } = ctx;
  const b = world.spawnHero(tint);
  const side = Math.random() < 0.5 ? -1 : 1;
  const far = motion.reduced ? -14 : -58;
  if (origin) b.placeOnWater(origin.x, origin.z, world.time);
  else b.placeOnWater(side * 9, far, world.time);
  b.heading = Math.PI * 0.8 * side;
  b.root.scale.setScalar(origin ? 2.2 : motion.reduced ? 1 : 3);
  b.opacity = 0;
  b.glow = 1.2;
  world.glowTarget = b;
  world.glowIntensity = 1.2;

  world.rig.flyTo('find', D(2.4));
  world.fadeBottle(b, 1, D(2.2));

  const dur = motion.reduced ? 1.2 : origin ? 6 : 10;
  const tl = gsap.timeline();
  tl.to(b.root.position, { z: 3.6, duration: dur, ease: 'sine.out' }, 0)
    .to(b.root.position, { x: 0.15, duration: dur, ease: 'power1.inOut' }, 0)
    .to(b.root.scale, { x: 1.45, y: 1.45, z: 1.45, duration: dur, ease: 'sine.out' }, 0);
  return { bottle: b, arrived: finished(tl) };
}

export async function openSequence(ctx: SeqContext, b: Bottle): Promise<void> {
  const { world, audio } = ctx;
  killBottleTweens(b);
  b.mode = 'free';
  b.drift.set(0, 0);

  const portrait = world.rig.isPortrait;
  const dest = portrait ? new Vector3(0, 1.9, 3.6) : new Vector3(-1.4, 1.25, 3.6);
  const q0 = b.root.quaternion.clone();
  const q1 = new Quaternion().setFromEuler(new Euler(0, 0.0, 0.16));
  const mix = { p: 0 };
  const corkMat = b.cork.material as Material & { opacity: number };
  const scrollMat = (b.scroll.children[0] as unknown as { material: Material & { opacity: number } }).material;
  for (const m of [corkMat, scrollMat]) {
    m.transparent = true;
    m.needsUpdate = true;
  }

  const tl = gsap.timeline();
  tl.to(b.root.position, { x: dest.x, y: dest.y, z: dest.z, duration: D(1.2), ease: 'power3.out' }, 0)
    .to(b.root.scale, { x: 1.25, y: 1.25, z: 1.25, duration: D(1.2), ease: 'power3.out' }, 0)
    .to(mix, { p: 1, duration: D(1.2), ease: 'power3.out', onUpdate: () => b.root.quaternion.slerpQuaternions(q0, q1, mix.p) }, 0)
    .to(b.tilt.rotation, { x: 0, duration: D(1.2), ease: 'power3.out' }, 0)
    .to(world, { glowIntensity: 4.2, duration: D(1.0) }, 0.3)
    .add(() => {
      audio.cork();
      const p = new Vector3();
      b.cork.getWorldPosition(p);
      world.splash.emit(p.x, p.y, p.z, 14, 1.6, 0.05);
    }, D(1.15))
    .to(b.cork.position, { y: 1.6, x: 0.45, duration: D(0.9), ease: 'power2.out' }, D(1.15))
    .to(b.cork.rotation, { z: 5, duration: D(0.9), ease: 'none' }, D(1.15))
    .to(corkMat, { opacity: 0, duration: D(0.5) }, D(1.5))
    .add(() => audio.rustle(), D(1.55))
    .to(b.scroll.position, { y: 0.78, duration: D(1.0), ease: 'power2.out' }, D(1.55))
    .to(world, { glowIntensity: 6, duration: D(0.5) }, D(1.7))
    .to(scrollMat, { opacity: 0, duration: D(0.6) }, D(2.1))
    .to(world, { glowIntensity: 1.6, duration: D(1.0) }, D(2.3));
  await finished(tl);
}

export async function throwBackSequence(ctx: SeqContext, b: Bottle): Promise<void> {
  const { world } = ctx;
  killBottleTweens(b);
  b.mode = 'free';
  b.tilt.rotation.x = 0;
  b.root.scale.setScalar(1);
  await loadBottle(ctx, b, true);
  void world;
  await hurl(ctx, b);
}

export function sendAway(ctx: SeqContext, b: Bottle, fadeSeconds = 3.2): void {
  const { world } = ctx;
  killBottleTweens(b);
  const go = (): void => {
    gsap.to(b.drift, { x: 0.3, y: -0.9, duration: D(5), ease: 'power1.in' });
    world.fadeBottle(b, 0, D(fadeSeconds), () => world.removeBottle(b));
  };
  if (world.glowTarget === b) {
    gsap.to(world, { glowIntensity: 0, duration: D(0.8), onComplete: () => {
      if (world.glowTarget === b) world.glowTarget = null;
    } });
  }
  if (b.mode === 'float') {
    go();
    return;
  }
  const landed = landing(b);
  b.release();
  void landed.then(go);
}
