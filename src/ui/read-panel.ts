import gsap from 'gsap';
import type { BottleNote, FoundBottle } from '../api';
import { MAX_COMMENT } from '../../shared/rules';
import { motion } from '../motion';
import { rated } from '../storage';
import { button, h, icon, Layer } from './dom';

export type RateResult = { ok: true; up: number; down: number } | { ok: false; message: string };

export interface ReadHandlers {
  onThrowBack: () => void;
  onFindAnother: () => void;
  onReply: () => void;
  onReport: () => void;
  onRate: (value: 1 | -1, comment: string) => Promise<RateResult>;
}

const THUMB_UP =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11v9H4v-9h3zM7 11l4-8c1.7 0 2.7 1.3 2.4 3L13 9h5.6a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.4 20H7"/></svg>';
const THUMB_DOWN =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17 13V4h3v9h-3zM17 13l-4 8c-1.7 0-2.7-1.3-2.4-3L11 15H5.4a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.6 4H17"/></svg>';

function describeAge(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return 'Cast into the sea some time ago';
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return 'Cast into the sea today';
  if (days === 1) return 'Cast into the sea yesterday';
  return `Cast into the sea ${days} days ago`;
}

export class ReadPanel extends Layer {
  private readonly note = h('p', { class: 'note-text', attrs: { tabindex: '-1' } });
  private readonly age = h('p', { class: 'note-age' });
  private readonly parchment = h('div', { class: 'parchment' });
  private readonly actions = h('div', { class: 'actions' });
  private readonly confirm = h('div', { class: 'report-confirm', attrs: { role: 'group', 'aria-label': 'Confirm report' } });
  private readonly reportButton: HTMLButtonElement;
  private readonly replyButton: HTMLButtonElement;

  private readonly feedback = h('section', { class: 'feedback', attrs: { 'aria-label': 'Rate this message' } });
  private readonly upButton: HTMLButtonElement;
  private readonly downButton: HTMLButtonElement;
  private readonly upCount = h('span', { class: 'count', text: '0' });
  private readonly downCount = h('span', { class: 'count', text: '0' });
  private readonly noteForm = h('form', { class: 'note-form' });
  private readonly noteInput: HTMLTextAreaElement;
  private readonly noteSend: HTMLButtonElement;
  private readonly feedbackStatus = h('p', { class: 'feedback-status', attrs: { role: 'status', 'aria-live': 'polite' } });
  private readonly notesBox = h('section', { class: 'notes', attrs: { 'aria-label': 'Notes left on this bottle' } });
  private readonly notesList = h('ul', { class: 'notes-list' });

  private bottleId = '';
  private choice: 1 | -1 | null = null;
  private sending = false;

  constructor(private readonly handlers: ReadHandlers) {
    const root = h('section', { class: 'read', attrs: { role: 'dialog', 'aria-labelledby': 'read-title', 'aria-modal': 'true' } });
    super(root);

    this.parchment.append(h('p', { class: 'kicker', text: 'A message from a stranger', attrs: { id: 'read-title' } }), this.note, this.age);

    this.upButton = h('button', { class: 'thumb', attrs: { type: 'button', 'aria-pressed': 'false', 'aria-label': 'Thumbs up: this message was kind or helpful' } }, icon(THUMB_UP), this.upCount);
    this.downButton = h('button', { class: 'thumb', attrs: { type: 'button', 'aria-pressed': 'false', 'aria-label': 'Thumbs down: this message was not for me' } }, icon(THUMB_DOWN), this.downCount);
    this.upButton.addEventListener('click', () => this.choose(1));
    this.downButton.addEventListener('click', () => this.choose(-1));

    this.noteInput = h('textarea', {
      class: 'note-small',
      attrs: { id: 'rating-note', rows: '2', maxlength: String(MAX_COMMENT + 20), placeholder: 'Add a note for this bottle (optional)', 'aria-label': 'Add a note for this bottle (optional)' },
    });
    this.noteSend = button('Send', 'btn-primary btn-sm', () => void this.submitRating(), { type: 'submit' });
    this.noteForm.append(this.noteInput, h('div', { class: 'note-form-row' }, h('span', { class: 'note-hint', text: 'Anyone who opens this bottle can read it.' }), this.noteSend));
    this.noteForm.hidden = true;
    this.noteForm.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.submitRating();
    });

    this.feedback.append(
      h('div', { class: 'feedback-row' }, h('span', { class: 'feedback-label', text: 'Rate this message' }), h('div', { class: 'thumbs' }, this.upButton, this.downButton)),
      this.noteForm,
      this.feedbackStatus,
    );

    this.notesBox.append(h('h3', { class: 'notes-title', text: 'Notes on this bottle' }), this.notesList);
    this.notesBox.hidden = true;

    this.reportButton = button('Report', 'btn-quiet', () => this.askReport());
    this.replyButton = button('Write back', 'btn-primary', handlers.onReply);
    this.actions.append(this.replyButton, button('Find another', 'btn-glass', handlers.onFindAnother), button('Throw it back', 'btn-glass', handlers.onThrowBack), this.reportButton);

    this.confirm.hidden = true;
    const yes = button('Yes, report it', 'btn-danger', () => {
      this.cancelReport();
      handlers.onReport();
    });
    const no = button('Keep it', 'btn-ghost', () => this.cancelReport());
    this.confirm.append(h('p', { text: 'Report this bottle as unkind or unsafe? It will be hidden after a few reports.' }), h('div', { class: 'actions' }, yes, no));

    root.append(this.parchment, this.feedback, this.notesBox, this.confirm, this.actions);
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!this.confirm.hidden) this.cancelReport();
        else if (!this.noteForm.hidden && !this.sending) this.dismissForm();
        else handlers.onThrowBack();
      }
    });
  }

  async open(bottle: FoundBottle): Promise<void> {
    this.bottleId = bottle.id;
    this.note.textContent = bottle.text;
    this.age.textContent = describeAge(bottle.createdAt);
    this.upCount.textContent = String(bottle.up);
    this.downCount.textContent = String(bottle.down);
    this.resetFeedback(rated.has(bottle.id));
    this.setNotes([]);
    this.replyButton.textContent = 'Write back';
    this.cancelReport();
    this.setActionsDisabled(false);
    await this.show(24);
    gsap.killTweensOf([this.parchment, this.note, this.age]);
    if (motion.reduced) {
      gsap.set([this.parchment, this.note, this.age], { clearProps: 'all' });
    } else {
      gsap.fromTo(this.parchment, { clipPath: 'inset(0 0 100% 0)', scaleY: 0.9, transformOrigin: '50% 0%' }, { clipPath: 'inset(0 0 0% 0)', scaleY: 1, duration: 1.1, ease: 'power3.out', clearProps: 'clipPath,scaleY' });
      gsap.fromTo([this.note, this.age], { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.8, delay: 0.45, stagger: 0.12, ease: 'power1.out' });
    }
    this.note.focus({ preventScroll: true });
  }

  async reopen(): Promise<void> {
    this.setActionsDisabled(false);
    await this.show(14);
    this.replyButton.focus({ preventScroll: true });
  }

  markReplied(): void {
    this.replyButton.textContent = 'Reply sent';
    this.replyButton.disabled = true;
  }

  setCounts(up: number, down: number): void {
    this.upCount.textContent = String(up);
    this.downCount.textContent = String(down);
  }

  setNotes(notes: readonly BottleNote[]): void {
    this.notesList.replaceChildren(
      ...notes.map((n) => {
        const mark =
          n.kind === 'rating'
            ? h('span', { class: `note-mark ${n.rating === -1 ? 'is-down' : 'is-up'}`, attrs: { role: 'img', 'aria-label': n.rating === -1 ? 'Thumbs down' : 'Thumbs up' } }, icon(n.rating === -1 ? THUMB_DOWN : THUMB_UP))
            : h('span', { class: 'note-mark', text: 'Reply', attrs: { 'aria-label': 'A reply left for the writer' } });
        return h('li', { class: 'notes-item' }, mark, h('span', { class: 'notes-text', text: n.text }));
      }),
    );
    this.notesBox.hidden = notes.length === 0;
  }

  setActionsDisabled(disabled: boolean): void {
    for (const b of this.actions.querySelectorAll('button')) {
      if (b === this.replyButton && this.replyButton.textContent === 'Reply sent') continue;
      b.disabled = disabled;
    }
  }

  private resetFeedback(alreadyRated: boolean): void {
    this.choice = null;
    this.sending = false;
    this.noteInput.value = '';
    this.noteForm.hidden = true;
    this.feedbackStatus.textContent = alreadyRated ? 'You already rated this bottle. Thank you.' : '';
    for (const b of [this.upButton, this.downButton]) {
      b.disabled = alreadyRated;
      b.setAttribute('aria-pressed', 'false');
    }
    this.noteSend.disabled = false;
    this.noteSend.textContent = 'Send';
  }

  private choose(value: 1 | -1): void {
    if (this.sending) return;
    this.choice = value;
    this.upButton.setAttribute('aria-pressed', String(value === 1));
    this.downButton.setAttribute('aria-pressed', String(value === -1));
    this.noteForm.hidden = false;
    this.feedbackStatus.textContent = '';
    this.noteInput.focus({ preventScroll: true });
  }

  private dismissForm(): void {
    this.choice = null;
    this.noteForm.hidden = true;
    this.upButton.setAttribute('aria-pressed', 'false');
    this.downButton.setAttribute('aria-pressed', 'false');
  }

  private async submitRating(): Promise<void> {
    if (this.choice === null || this.sending) return;
    this.sending = true;
    this.noteSend.disabled = true;
    this.noteSend.textContent = 'Sending…';
    const comment = this.noteInput.value.trim();
    const result = await this.handlers.onRate(this.choice, comment);
    this.sending = false;
    if (!result.ok) {
      this.noteSend.disabled = false;
      this.noteSend.textContent = 'Send';
      this.feedbackStatus.textContent = result.message;
      return;
    }
    rated.add(this.bottleId);
    this.upCount.textContent = String(result.up);
    this.downCount.textContent = String(result.down);
    this.noteForm.hidden = true;
    for (const b of [this.upButton, this.downButton]) b.disabled = true;
    this.feedbackStatus.textContent = comment ? 'Thank you. Your note was left on the bottle.' : 'Thank you for rating.';
  }

  private askReport(): void {
    this.confirm.hidden = false;
    this.actions.hidden = true;
    this.confirm.querySelector('button')?.focus();
  }

  private cancelReport(): void {
    const wasOpen = !this.confirm.hidden;
    this.confirm.hidden = true;
    this.actions.hidden = false;
    if (wasOpen) this.reportButton.focus();
  }
}
