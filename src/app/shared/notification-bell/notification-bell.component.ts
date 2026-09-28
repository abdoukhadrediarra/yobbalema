import { DatePipe } from '@angular/common';
import { Component, effect, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AppNotification } from '../../core/models/models';
import { NotificationsService } from '../../core/services/notifications.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../core/services/toast.service';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="bell">
      <button class="bell__btn" type="button" (click)="toggle()" [attr.aria-expanded]="open()" aria-label="Notifications">
        <i class="bi bi-bell"></i>
        @if (notif.unread() > 0) { <span class="bell__badge">{{ notif.unread() > 9 ? '9+' : notif.unread() }}</span> }
      </button>
      @if (open()) {
        <div class="bell__backdrop" (click)="open.set(false)"></div>
        <div class="bell__panel" role="dialog" aria-label="Notifications">
          <div class="bell__head">
            <strong>Notifications</strong>
            @if (notif.unread() > 0) { <button type="button" class="bell__link" (click)="notif.markAllRead()">Tout marquer comme lu</button> }
          </div>
          <div class="bell__list">
            @for (n of notif.items(); track n.id) {
              <button type="button" class="bell__item" [class.bell__item--new]="!n.lu" (click)="go(n)">
                <span class="bell__title">{{ n.titre }}</span>
                @if (n.corps) { <span class="bell__body">{{ n.corps }}</span> }
                <span class="bell__time">{{ n.created_at | date: 'd MMM, HH:mm' }}</span>
              </button>
            } @empty {
              <p class="bell__empty"><i class="bi bi-bell-slash"></i><br>Aucune notification pour le moment.</p>
            }
          </div>
        </div>
      }
    </div>
  `,
  styles: [`
    .bell { position: relative; }
    .bell__btn { position: relative; background: none; border: 1.5px solid var(--color-paper-line); width: 2.6rem; height: 2.6rem; border-radius: 50%; cursor: pointer; color: var(--color-ink); font-size: 1.1rem; display: grid; place-items: center; }
    .bell__btn:hover { background: var(--color-paper-raised); }
    .bell__badge { position: absolute; top: -0.35rem; right: -0.35rem; min-width: 1.25rem; height: 1.25rem; padding: 0 0.3rem; border-radius: 999px; background: var(--color-rust); color: #fff; font-size: 0.7rem; font-weight: 700; display: grid; place-items: center; }
    .bell__backdrop { position: fixed; inset: 0; z-index: 45; }
    .bell__panel { position: absolute; z-index: 50; right: 0; top: calc(100% + 0.6rem); width: min(92vw, 380px); background: var(--color-white); border: 1px solid var(--color-paper-line); border-radius: var(--radius-md); box-shadow: var(--shadow-lifted); overflow: hidden; }
    .bell__head { display: flex; justify-content: space-between; align-items: center; padding: 0.9rem 1rem; border-bottom: 1px solid var(--color-paper-line); font-size: var(--text-sm); }
    .bell__link { background: none; border: none; cursor: pointer; font-size: var(--text-xs); font-weight: 700; color: var(--color-gold-deep); }
    .bell__list { max-height: 420px; overflow-y: auto; }
    .bell__item { display: flex; flex-direction: column; gap: 0.15rem; width: 100%; text-align: left; background: none; border: none; border-bottom: 1px solid var(--color-paper-line); padding: 0.85rem 1rem; cursor: pointer; font: inherit; }
    .bell__item:hover { background: var(--color-paper-raised); }
    .bell__item--new { background: rgba(240, 169, 60, 0.1); }
    .bell__title { font-weight: 700; font-size: var(--text-sm); color: var(--color-ink); }
    .bell__body { font-size: var(--text-xs); color: var(--color-text-soft); }
    .bell__time { font-size: 0.7rem; color: var(--color-text-soft); opacity: 0.8; }
    .bell__empty { text-align: center; padding: 2rem 1rem; margin: 0; color: var(--color-text-soft); font-size: var(--text-sm); }
    .bell__empty i { font-size: 1.6rem; }
  `],
})
export class NotificationBellComponent {
  readonly open = signal(false);

  constructor(public notif: NotificationsService, private router: Router, private sb: SupabaseService, private toast: ToastService) {
    effect(() => {
      const n = this.notif.latest();
      if (n) this.toast.info(n.titre + (n.corps ? ' — ' + n.corps : ''));
    });
  }

  toggle() {
    this.open.update((v) => !v);
    if (this.open()) this.notif.load();
  }

  go(n: AppNotification) {
    this.open.set(false);
    this.router.navigateByUrl(this.notif.routeFor(n, this.sb.currentProfile()?.role));
    if (!n.lu) this.notif.markAllRead();
  }
}
