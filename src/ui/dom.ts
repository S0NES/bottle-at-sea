import gsap from 'gsap';
import { motion } from '../motion';

export type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
  onClick?: (e: MouseEvent) => void;
}

/**
 * Tiny element builder. All text goes through `textContent` / text nodes, so
 * user-supplied strings can never be parsed as HTML.
 */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  if (props.onClick) {
    const handler = props.onClick;
    el.addEventListener('click', (e) => handler(e as MouseEvent));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

export function icon(svg: string): HTMLSpanElement {
  const span = h('span', { class: 'icon', attrs: { 'aria-hidden': 'true' } });
  span.innerHTML = svg;
  return span;
}

export function button(label: string, cls: string, onClick: (e: MouseEvent) => void, extra: Record<string, string> = {}): HTMLButtonElement {
  return h('button', { class: `btn ${cls}`, text: label, onClick, attrs: { type: 'button', ...extra } });
}

export class Layer {
  visible = false;

  constructor(readonly root: HTMLElement) {
    root.hidden = true;
    root.inert = true;
  }

  show(fromY = 18): Promise<void> {
    this.visible = true;
    this.root.hidden = false;
    this.root.inert = false;
    gsap.killTweensOf(this.root);
    return new Promise((resolve) => {
      gsap.fromTo(
        this.root,
        { autoAlpha: 0, y: motion.reduced ? 0 : fromY },
        { autoAlpha: 1, y: 0, duration: motion.d(0.8), ease: 'power3.out', onComplete: () => resolve() },
      );
    });
  }

  hide(toY = -10): Promise<void> {
    this.visible = false;
    this.root.inert = true;
    gsap.killTweensOf(this.root);
    return new Promise((resolve) => {
      if (this.root.hidden) {
        resolve();
        return;
      }
      gsap.to(this.root, {
        autoAlpha: 0,
        y: motion.reduced ? 0 : toY,
        duration: motion.d(0.45),
        ease: 'power2.in',
        onComplete: () => {
          if (!this.visible) this.root.hidden = true;
          resolve();
        },
      });
    });
  }
}

export function mount(parent: HTMLElement, ...els: HTMLElement[]): void {
  for (const el of els) parent.append(el);
}
