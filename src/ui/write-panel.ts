import gsap from 'gsap';
import { motion } from '../motion';
import { MAX_TEXT, normalizeEmail, validateBottle, validateReply } from '../../shared/rules';
import { TINTS } from '../scene/bottle';
import { button, h, icon, Layer } from './dom';

export type SubmitResult = { ok: true } | { ok: false; message: string };
export type WriteMode = 'write' | 'reply';

export interface WriteHandlers {
  /** `email` is empty unless the writer opted in; replies always pass tint 0 and no email. */
  onSubmit: (mode: WriteMode, text: string, tint: number, email: string) => Promise<SubmitResult>;
  onCancel: (mode: WriteMode) => void;
}

function bottleIcon(color: string): string {
  return `<svg viewBox="0 0 32 66" width="34" height="70" fill="none" stroke-linejoin="round" stroke-linecap="round">
    <path class="b-glass" d="M13.500 8h5v5l-1.500 4c4 2 6.500 5 6.500 9v30a5 5 0 0 1-5 5h-5a5 5 0 0 1-5-5V26c0-4 2.500-7 6.500-9l-1.500-4V8z" stroke="${color}" stroke-width="1.600" fill="${color}" fill-opacity="0.16"/>
    <rect x="13" y="2" width="6" height="7" rx="1.500" fill="#b9753a"/>
    <rect class="b-paper" x="12.500" y="28" width="7" height="26" rx="3.500" fill="#cfc6ad"/>
  </svg>`;
}

const CLOSE_X =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

const GLASS_NAME = ['clear', 'amber', 'sea', 'cobalt', 'violet'];

export class WritePanel extends Layer {
  private readonly textarea: HTMLTextAreaElement;
  private readonly counter: HTMLSpanElement;
  private readonly counterLive: HTMLSpanElement;
  private readonly error: HTMLParagraphElement;
  private readonly submit: HTMLButtonElement;
  private readonly cancel: HTMLButtonElement;
  private readonly radios: HTMLInputElement[] = [];
  private readonly heading: HTMLHeadingElement;
  private readonly prompt: HTMLParagraphElement;
  private readonly hint: HTMLParagraphElement;
  private readonly tints: HTMLFieldSetElement;
  private readonly caption: HTMLParagraphElement;
  private readonly emailTag: HTMLDivElement;
  private readonly email: HTMLInputElement;
  private readonly sheet: HTMLDivElement;
  private readonly extras: HTMLElement[];
  private busy = false;
  private lastAnnounced = -1;
  mode: WriteMode = 'write';

  constructor(private readonly handlers: WriteHandlers) {
    const root = h('section', { class: 'write composer', attrs: { role: 'dialog', 'aria-labelledby': 'write-title', 'aria-modal': 'true' } });
    super(root);

    this.heading = h('h2', { class: 'sr-only', text: 'Write a message', attrs: { id: 'write-title' } });
    this.prompt = h('p', { class: 'sheet-prompt', text: 'To whoever finds this,' });
    this.hint = h('p', { class: 'sheet-hint' });

    this.textarea = h('textarea', {
      class: 'note-input',
      attrs: { id: 'note', rows: '5', maxlength: String(MAX_TEXT + 40), placeholder: 'Say the thing you can’t say out loud…', spellcheck: 'true', autocomplete: 'off', 'aria-describedby': 'note-count note-error', 'aria-label': 'Your message' },
    });
    this.counter = h('span', { class: 'counter', text: `0 of ${MAX_TEXT}`, attrs: { id: 'note-count' } });
    this.counterLive = h('span', { class: 'sr-only', attrs: { 'aria-live': 'polite' } });
    this.error = h('p', { class: 'form-error', attrs: { id: 'note-error', role: 'alert' } });

    this.sheet = h(
      'div',
      { class: 'scroll-sheet' },
      this.prompt,
      this.hint,
      this.textarea,
      h('div', { class: 'field-meta' }, this.error, this.counter, this.counterLive),
    );
    this.cancel = button('', 'btn-icon scroll-close', () => this.handlers.onCancel(this.mode), { 'aria-label': 'Cancel', title: 'Cancel' });
    this.cancel.append(icon(CLOSE_X));
    const scroll = h(
      'div',
      { class: 'scroll' },
      h('div', { class: 'scroll-roll', attrs: { 'aria-hidden': 'true' } }),
      h('div', { class: 'scroll-body' }, this.sheet, this.cancel),
      h('div', { class: 'scroll-roll', attrs: { 'aria-hidden': 'true' } }),
    );

    this.tints = h('fieldset', { class: 'tints' }, h('legend', { class: 'sr-only', text: 'Glass tint' }));
    const row = h('div', { class: 'bottle-row' });
    TINTS.forEach((tint, i) => {
      const input = h('input', { class: 'tint-input', attrs: { type: 'radio', name: 'tint', value: String(i), id: `tint-${i}` } });
      if (i === 0) input.checked = true;
      input.addEventListener('change', () => this.updateCaption());
      this.radios.push(input);
      row.append(h('label', { class: 'bottle-pick', attrs: { for: `tint-${i}`, title: tint.name } }, input, icon(bottleIcon(tint.css)), h('span', { class: 'sr-only', text: tint.name })));
    });
    this.caption = h('p', { class: 'tint-caption', attrs: { 'aria-live': 'polite' } });
    this.tints.append(row, h('div', { class: 'caption-rule', attrs: { 'aria-hidden': 'true' } }), this.caption);

    this.email = h('input', {
      class: 'tag-input',
      attrs: { id: 'reply-email', type: 'email', inputmode: 'email', autocomplete: 'email', placeholder: 'your email', maxlength: '254', 'aria-describedby': 'email-hint' },
    });
    this.emailTag = h(
      'div',
      { class: 'email-tag' },
      h('label', { class: 'tag-label', attrs: { for: 'reply-email' } }, 'If you’d like to hear back ', h('span', { text: '(optional)' })),
      this.email,
      h('p', { class: 'tag-hint', text: 'Never shown to anyone. A stranger’s reply reaches you once, by email. You can’t answer it, and they never learn who you are.', attrs: { id: 'email-hint' } }),
    );

    this.submit = button('Send', 'btn-primary btn-lg', () => void this.send(), { 'aria-label': 'Seal and throw the bottle' });
    const actions = h('div', { class: 'composer-actions' }, this.submit);

    this.extras = [this.tints, this.emailTag, actions];
    root.append(this.heading, scroll, this.tints, this.emailTag, actions);

    this.textarea.addEventListener('input', () => this.onInput());
    this.email.addEventListener('input', () => this.clearError());
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !this.busy) {
        e.preventDefault();
        this.handlers.onCancel(this.mode);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void this.send();
      }
    });
    this.updateCaption();
  }

  rollUp(): Promise<void> {
    if (motion.reduced) return Promise.resolve();
    const start = this.sheet.offsetHeight;
    this.root.inert = true;
    return new Promise((resolve) => {
      gsap
        .timeline({ onComplete: () => resolve() })
        .to(this.extras, { opacity: 0, y: 14, duration: 0.35, ease: 'power2.in' }, 0)
        .fromTo(this.sheet, { height: start, overflow: 'hidden' }, { height: 0, paddingTop: 0, paddingBottom: 0, opacity: 0.2, duration: 0.95, ease: 'power3.inOut' }, 0.1)
        .to(this.root, { scale: 0.55, y: 40, duration: 0.45, ease: 'power2.in' }, '-=0.15');
    });
  }

  private unroll(): void {
    gsap.set(this.sheet, { clearProps: 'height,overflow,paddingTop,paddingBottom,opacity' });
    gsap.set(this.extras, { clearProps: 'opacity,transform' });
    gsap.set(this.root, { clearProps: 'scale' });
  }

  get tint(): number {
    return Math.max(0, this.radios.findIndex((r) => r.checked));
  }

  private updateCaption(): void {
    const t = TINTS[this.tint];
    this.caption.textContent = `Sealed in ${(GLASS_NAME[this.tint] ?? t?.name.toLowerCase() ?? 'clear')} glass`;
  }

  open(mode: WriteMode = 'write'): Promise<void> {
    this.unroll();
    this.mode = mode;
    const reply = mode === 'reply';
    this.heading.textContent = reply ? 'Write back' : 'Write a message';
    this.prompt.textContent = reply ? 'To the one who wrote this,' : 'To whoever finds this,';
    this.hint.textContent = reply
      ? 'If they left an email, your words reach them privately, once. Otherwise they stay as a note on the bottle. Either way they can’t answer you.'
      : '';
    this.hint.hidden = !reply;
    this.textarea.placeholder = reply ? 'I read your bottle, and…' : 'Say the thing you can’t say out loud…';
    this.tints.hidden = reply;
    this.emailTag.hidden = reply;
    this.submit.setAttribute('aria-label', reply ? 'Send reply' : 'Seal and throw the bottle');
    this.setBusy(false);
    this.clearError();
    const shown = this.show();
    window.setTimeout(() => this.textarea.focus({ preventScroll: true }), 120);
    return shown;
  }

  clear(): void {
    this.textarea.value = '';
    this.email.value = '';
    this.onInput();
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    this.submit.disabled = busy;
    this.submit.textContent = busy ? 'Sending…' : 'Send';
    this.submit.setAttribute('aria-busy', String(busy));
    this.textarea.readOnly = busy;
    this.email.readOnly = busy;
    this.cancel.disabled = busy;
  }

  showError(message: string): void {
    this.error.textContent = message;
    this.textarea.setAttribute('aria-invalid', 'true');
  }

  private clearError(): void {
    if (this.error.textContent) this.error.textContent = '';
    this.textarea.removeAttribute('aria-invalid');
    this.email.removeAttribute('aria-invalid');
  }

  private onInput(): void {
    const n = [...this.textarea.value].length;
    this.counter.textContent = `${n} of ${MAX_TEXT}`;
    this.counter.classList.toggle('is-warm', n > MAX_TEXT * 0.9);
    this.counter.classList.toggle('is-over', n > MAX_TEXT);
    this.clearError();
    const left = MAX_TEXT - n;
    const bucket = left < 0 ? -1 : left <= 20 ? left : left <= 50 ? 50 : 999;
    if (bucket !== this.lastAnnounced && bucket !== 999) {
      this.lastAnnounced = bucket;
      this.counterLive.textContent = left < 0 ? `${-left} characters over the limit` : `${left} characters left`;
    }
  }

  private async send(): Promise<void> {
    if (this.busy) return;
    let text: string;
    let email = '';
    if (this.mode === 'reply') {
      const check = validateReply({ text: this.textarea.value });
      if (!check.ok) {
        this.showError(check.error);
        this.textarea.focus();
        return;
      }
      text = check.text;
    } else {
      const rawEmail = this.email.value.trim();
      const check = validateBottle({ text: this.textarea.value, tint: this.tint, ...(rawEmail ? { email: rawEmail } : {}) });
      if (!check.ok) {
        this.showError(check.error);
        if (check.code === 'invalid_email') {
          this.email.setAttribute('aria-invalid', 'true');
          this.email.focus();
        } else {
          this.textarea.focus();
        }
        return;
      }
      text = check.text;
      email = rawEmail ? (normalizeEmail(rawEmail) ?? '') : '';
    }
    this.setBusy(true);
    const result = await this.handlers.onSubmit(this.mode, text, this.mode === 'reply' ? 0 : this.tint, email);
    if (!result.ok) {
      this.setBusy(false);
      this.showError(result.message);
      this.textarea.focus();
    }
  }
}
