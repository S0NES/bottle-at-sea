import { button, h, icon, Layer } from './dom';

const SOUND_ON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M15.5 9a4 4 0 0 1 0 6"/><path d="M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>';
const SOUND_OFF = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>';
const SUN = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>';
const MOON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/></svg>';
const POWER = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z"/></svg>';

export interface HudHandlers {
  onToggleSound: () => void;
  onToggleLowPower: () => void;
  onCycleTime: () => void;
}

/**
 * The top navigation. The server already sent it as HTML (title, coffee link
 * and the number of bottles adrift), so it shows before any script runs; here
 * we adopt it and add the interactive controls.
 */
export class Hud {
  readonly root: HTMLElement;
  private readonly adrift: HTMLElement | null;
  private readonly sound: HTMLButtonElement;
  private readonly power: HTMLButtonElement;
  private readonly time: HTMLButtonElement;
  private readonly live = h('div', { class: 'sr-only', attrs: { id: 'live', 'aria-live': 'polite', 'aria-atomic': 'true' } });

  constructor(h_: HudHandlers) {
    this.sound = button('', 'btn-icon', h_.onToggleSound, { 'aria-pressed': 'false', 'aria-label': 'Ambient sound: off. Turn on' });
    this.sound.append(icon(SOUND_OFF));
    this.power = button('', 'btn-icon', h_.onToggleLowPower, { 'aria-pressed': 'false', 'aria-label': 'Low power mode: off. Turn on', title: 'Low power mode' });
    this.power.append(icon(POWER));
    this.time = button('', 'btn-icon', h_.onCycleTime, { 'aria-label': 'Time of day: follows your clock. Change', title: 'Time of day' });
    this.time.append(icon(SUN));

    this.root = document.getElementById('nav') ?? h('header', { class: 'nav', attrs: { id: 'nav' } }, h('div', { class: 'nav-right' }));
    this.adrift = this.root.querySelector<HTMLElement>('#adrift');
    this.root.querySelector('.nav-right')?.prepend(...(this.adrift ? [this.adrift] : []), this.time, this.sound);
    document.body.append(this.live);
  }

  initialAdrift(): number | null {
    if (!this.adrift || this.adrift.hidden) return null;
    const n = Number(this.adrift.querySelector('#adrift-count')?.textContent);
    return Number.isFinite(n) ? n : null;
  }

  setAdrift(bottles: number): void {
    if (!this.adrift) return;
    const count = this.adrift.querySelector('#adrift-count');
    const label = this.adrift.querySelector('#adrift-label');
    if (count) count.textContent = String(bottles);
    if (label) label.textContent = bottles === 1 ? 'bottle adrift' : 'bottles adrift';
    this.adrift.hidden = false;
  }

  setTimeMode(label: string, night: boolean): void {
    this.time.setAttribute('aria-label', `Time of day: ${label}. Change`);
    this.time.title = `Time of day: ${label}`;
    this.time.replaceChildren(icon(night ? MOON : SUN));
  }

  setSound(on: boolean): void {
    this.sound.setAttribute('aria-pressed', String(on));
    this.sound.setAttribute('aria-label', on ? 'Ambient sound: on. Turn off' : 'Ambient sound: off. Turn on');
    this.sound.title = on ? 'Mute' : 'Unmute';
    this.sound.replaceChildren(icon(on ? SOUND_ON : SOUND_OFF));
  }

  setLowPower(on: boolean): void {
    this.power.setAttribute('aria-pressed', String(on));
    this.power.setAttribute('aria-label', on ? 'Low power mode: on. Turn off' : 'Low power mode: off. Turn on');
    this.power.classList.toggle('is-on', on);
  }

  announce(message: string): void {
    this.live.textContent = '';
    window.setTimeout(() => {
      this.live.textContent = message;
    }, 40);
  }
}

export interface FindBarHandlers {
  onOpen: () => void;
  onCancel: () => void;
}

export class FindBar extends Layer {
  private readonly status = h('p', { class: 'findbar-status', attrs: { 'aria-live': 'polite' } });
  private readonly open: HTMLButtonElement;

  constructor(handlers: FindBarHandlers) {
    const root = h('section', { class: 'findbar glass', attrs: { 'aria-label': 'Finding a bottle' } });
    super(root);
    this.open = button('Open the bottle', 'btn-primary', handlers.onOpen);
    this.open.hidden = true;
    const cancel = button('Let it drift by', 'btn-ghost', handlers.onCancel);
    root.append(this.status, h('div', { class: 'actions' }, this.open, cancel));
  }

  setSearching(): void {
    this.status.textContent = 'Listening for a bottle on the tide…';
    this.open.hidden = true;
  }

  setArriving(): void {
    this.status.textContent = 'A bottle is drifting toward you…';
    this.open.hidden = true;
  }

  setReady(): void {
    this.status.textContent = 'It has arrived. Tap the bottle to open it.';
    this.open.hidden = false;
    this.open.focus({ preventScroll: true });
  }
}
