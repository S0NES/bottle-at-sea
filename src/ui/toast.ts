import gsap from 'gsap';
import { motion } from '../motion';
import { h } from './dom';

export type ToastVariant = 'quiet' | 'poem';

let region: HTMLElement | null = null;

function ensureRegion(): HTMLElement {
  if (!region) {
    region = h('div', { class: 'toasts', attrs: { role: 'status', 'aria-live': 'polite' } });
    document.body.append(region);
  }
  return region;
}

export function showToast(message: string, variant: ToastVariant = 'quiet', ms = 3800): Promise<void> {
  const el = h('p', { class: `toast toast-${variant}`, text: message });
  ensureRegion().append(el);
  return new Promise((resolve) => {
    gsap
      .timeline({
        onComplete: () => {
          el.remove();
          resolve();
        },
      })
      .fromTo(el, { autoAlpha: 0, y: motion.reduced ? 0 : 14 }, { autoAlpha: 1, y: 0, duration: motion.d(0.9), ease: 'power2.out' })
      .to(el, { autoAlpha: 0, y: motion.reduced ? 0 : -8, duration: motion.d(0.9), ease: 'power1.in' }, `+=${ms / 1000}`);
  });
}
