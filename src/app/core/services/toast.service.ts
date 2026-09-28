import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  type: 'ok' | 'error' | 'info';
  text: string;
}

/** Notifications brèves affichées en bas d'écran (voir ToastHostComponent). */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private nextId = 1;

  ok(text: string) { this.push('ok', text); }
  error(text: string) { this.push('error', text, 7000); }
  info(text: string) { this.push('info', text); }

  dismiss(id: number) {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  private push(type: Toast['type'], text: string, ms = 4500) {
    const id = this.nextId++;
    this.toasts.update((list) => [...list.slice(-3), { id, type, text }]);
    setTimeout(() => this.dismiss(id), ms);
  }
}
