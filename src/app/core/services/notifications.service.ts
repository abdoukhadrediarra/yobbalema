import { Injectable, computed, effect, signal } from '@angular/core';
import { AppNotification } from '../models/models';
import { SupabaseService } from './supabase.service';

/** Notifications de l'utilisateur connecté, mises à jour en direct (Realtime) + rafraîchissement de secours. */
@Injectable({ providedIn: 'root' })
export class NotificationsService {
  readonly items = signal<AppNotification[]>([]);
  readonly unread = computed(() => this.items().filter((n) => !n.lu).length);
  /** Dernière notification arrivée pendant la session (pour afficher un toast). */
  readonly latest = signal<AppNotification | null>(null);

  private unwatch?: () => void;
  private timer?: ReturnType<typeof setInterval>;
  private known = new Set<string>();
  private first = true;

  constructor(private sb: SupabaseService) {
    effect(() => {
      const uid = this.sb.currentUser()?.id;
      this.stop();
      if (uid) this.start(uid);
      else { this.items.set([]); this.known.clear(); this.first = true; }
    });
  }

  private start(uid: string) {
    void this.load();
    this.unwatch = this.sb.watch('notifications', `user_id=eq.${uid}`, () => this.load());
    this.timer = setInterval(() => this.load(), 20000);
  }

  private stop() {
    this.unwatch?.(); this.unwatch = undefined;
    clearInterval(this.timer); this.timer = undefined;
  }

  async load() {
    if (!this.sb.uid) return;
    const { data, error } = await this.sb.client
      .from('notifications').select('*').order('created_at', { ascending: false }).limit(40);
    if (error) return;
    const list = data as AppNotification[];
    if (!this.first) {
      const fresh = list.filter((n) => !this.known.has(n.id) && !n.lu);
      if (fresh.length) this.latest.set(fresh[0]);
    }
    list.forEach((n) => this.known.add(n.id));
    this.first = false;
    this.items.set(list);
  }

  async markAllRead() {
    if (!this.unread()) return;
    await this.sb.rpc('notifications_marquer_lues');
    this.items.update((l) => l.map((n) => ({ ...n, lu: true })));
  }

  /** Page à ouvrir quand on clique sur une notification. */
  routeFor(n: AppNotification, role: string | undefined): string {
    const t = n.type;
    if (t.startsWith('course_')) return role === 'chauffeur' && t === 'course_annulee' ? '/chauffeur/missions' : '/courses';
    if (t.startsWith('reservation_') || t.startsWith('trajet_')) return '/mes-trajets';
    if (t.startsWith('commande_') || t.startsWith('devis_') || t === 'livreur_arrive') return role === 'commercant' ? '/commerce' : '/livraisons';
    if (t.startsWith('livraison_')) return role === 'commercant' ? '/commerce' : role === 'chauffeur' ? '/chauffeur/missions' : '/livraisons';
    if (t.startsWith('dette_')) return '/chauffeur';
    if (t.startsWith('compte_')) return '/profil';
    if (t.startsWith('commerce_')) return '/commerce';
    return '/tableau-de-bord';
  }
}
