import { Component } from '@angular/core';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-toast-host',
  standalone: true,
  template: `
    <div class="toasts" aria-live="polite">
      @for (t of toast.toasts(); track t.id) {
        <div class="toast" [class]="'toast toast--' + t.type" role="status" (click)="toast.dismiss(t.id)">
          <i class="bi" [class]="t.type === 'ok' ? 'bi-check-circle-fill' : t.type === 'error' ? 'bi-exclamation-triangle-fill' : 'bi-info-circle-fill'"></i>
          <span>{{ t.text }}</span>
        </div>
      }
    </div>
  `,
  styles: [`
    .toasts { position: fixed; z-index: 100; left: 50%; bottom: 1.25rem; transform: translateX(-50%); display: flex; flex-direction: column; gap: 0.6rem; width: min(92vw, 460px); pointer-events: none; }
    .toast { pointer-events: auto; cursor: pointer; display: flex; gap: 0.75em; align-items: flex-start; padding: 0.9em 1.1em; border-radius: var(--radius-md);
      font-size: var(--text-sm); font-weight: 600; box-shadow: var(--shadow-lifted); background: var(--color-ink); color: var(--color-text-on-ink); animation: toast-in 0.2s ease-out; }
    .toast i { margin-top: 0.15em; }
    .toast--ok i { color: #5fd4c9; }
    .toast--error { background: var(--color-rust-deep); }
    .toast--info i { color: var(--color-gold); }
    @keyframes toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  `],
})
export class ToastHostComponent {
  constructor(public toast: ToastService) {}
}
