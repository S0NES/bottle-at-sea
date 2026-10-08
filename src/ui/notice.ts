import { button, h, Layer } from './dom';

export interface NoticeAction {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

export interface NoticeContent {
  title: string;
  body: string;
  actions: NoticeAction[];
}

export class Notice extends Layer {
  private readonly title = h('h2', { class: 'panel-title', attrs: { id: 'notice-title' } });
  private readonly body = h('p', { class: 'notice-body' });
  private readonly actions = h('div', { class: 'actions' });
  private dismiss: (() => void) | null = null;

  constructor() {
    const root = h('section', { class: 'notice glass', attrs: { role: 'alertdialog', 'aria-labelledby': 'notice-title', 'aria-modal': 'true' } });
    super(root);
    root.append(this.title, this.body, this.actions);
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.dismiss?.();
    });
  }

  open(content: NoticeContent): Promise<void> {
    this.title.textContent = content.title;
    this.body.textContent = content.body;
    this.actions.replaceChildren(
      ...content.actions.map((a) => button(a.label, a.primary ? 'btn-primary' : 'btn-glass', a.onClick)),
    );
    const last = content.actions[content.actions.length - 1];
    this.dismiss = last ? last.onClick : null;
    const shown = this.show();
    window.setTimeout(() => this.actions.querySelector('button')?.focus({ preventScroll: true }), 120);
    return shown;
  }
}
