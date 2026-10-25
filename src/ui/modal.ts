export interface ModalAction {
  label: string;
  primary?: boolean;
  danger?: boolean;
  onClick?: () => void | boolean;
}

export interface ModalOptions {
  title: string;
  body: string;
  actions?: ModalAction[];
  onMount?: (root: HTMLElement) => void;
  onClose?: () => void;
  wide?: boolean;
}

let escapeBound = false;
let currentOnClose: (() => void) | undefined;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function closeModal(): void {
  const root = document.getElementById('modal-root');
  if (!root) return;
  root.classList.add('hidden');
  root.innerHTML = '';
  const cb = currentOnClose;
  currentOnClose = undefined;
  cb?.();
}

export function openModal(options: ModalOptions): void {
  const root = document.getElementById('modal-root');
  if (!root) return;
  currentOnClose = options.onClose;
  root.classList.remove('hidden');
  root.innerHTML = `
    <div class="modal-card ${options.wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${escapeHtml(options.title)}">
      <div class="modal-head">
        <h2>${escapeHtml(options.title)}</h2>
        <button class="close" data-modal-close aria-label="Close">×</button>
      </div>
      <div class="modal-body">${options.body}</div>
      <div class="modal-actions"></div>
    </div>`;
  const actionsRoot = root.querySelector('.modal-actions');
  for (const action of options.actions ?? [{ label: 'Close' }]) {
    const btn = document.createElement('button');
    btn.className = `btn ${action.primary ? 'btn-primary' : 'btn-ghost'} ${action.danger ? 'btn-danger' : ''}`;
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      const keepOpen = action.onClick?.() === false;
      if (!keepOpen) closeModal();
    });
    actionsRoot?.appendChild(btn);
  }
  root.querySelector('[data-modal-close]')?.addEventListener('click', () => closeModal());
  root.addEventListener(
    'pointerdown',
    (event) => {
      if (event.target === root) closeModal();
    },
    { once: true },
  );
  options.onMount?.(root);
  if (!escapeBound) {
    escapeBound = true;
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !document.getElementById('modal-root')?.classList.contains('hidden')) {
        closeModal();
      }
    });
  }
}

export function confirmDialog(title: string, text: string, confirmLabel: string, onConfirm: () => void): void {
  openModal({
    title,
    body: `<p>${escapeHtml(text)}</p>`,
    actions: [
      { label: 'Cancel' },
      {
        label: confirmLabel,
        primary: true,
        onClick: onConfirm,
      },
    ],
  });
}
