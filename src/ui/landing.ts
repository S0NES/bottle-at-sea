import { button, h, icon, Layer } from './dom';

export interface LandingHandlers {
  onWrite: () => void;
  onFind: () => void;
}

const PLUS =
  '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>';

/**
 * The landing page is deliberately bare: one round "+" button at the bottom
 * centre. Finding a bottle happens by tapping one of the bottles drifting on
 * the sea; the visually hidden button below is the keyboard / screen-reader
 * route to it.
 */
export class Landing extends Layer {
  setSea(bottles: number): void {
    this.hint.textContent = bottles > 0 ? 'Tap a bottle drifting by, or' : 'The sea is quiet tonight. Throw the first one,';
  }

  readonly writeButton: HTMLButtonElement;
  readonly findButton: HTMLButtonElement;
  private readonly hint: HTMLParagraphElement;

  constructor(handlers: LandingHandlers) {
    const root = h('section', { class: 'landing', attrs: { 'aria-labelledby': 'site-title' } });
    super(root);
    this.writeButton = button('', 'fab', handlers.onWrite, { 'aria-label': 'Write a message', title: 'Write a message' });
    this.writeButton.append(icon(PLUS));
    this.hint = h('p', { class: 'center-hint', text: 'Tap a bottle drifting by, or', attrs: { 'aria-hidden': 'true' } });
    this.findButton = button('Find a bottle', 'sr-only-focusable', handlers.onFind);
    root.append(
      h(
        'div',
        { class: 'center' },
        this.hint,
        this.writeButton,
        h('span', { class: 'fab-caption', text: 'Write a message', attrs: { 'aria-hidden': 'true' } }),
      ),
      this.findButton,
    );
  }
}
