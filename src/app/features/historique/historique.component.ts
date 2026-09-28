import { DatePipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { DeliveryOrder, Payment, RideRequest } from '../../core/models/models';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../core/services/toast.service';
import { LIBELLES_CATEGORIE, LIBELLES_LIVRAISON, LIBELLES_MOYEN, fcfa, messageErreur } from '../../core/util/format';

type Tab = 'courses' | 'livraisons' | 'paiements';
const STATUT: Record<string, { txt: string; cls: string }> = {
  terminee: { txt: 'Terminée', cls: 'tag tag--ok' }, livree: { txt: 'Livrée', cls: 'tag tag--ok' },
  annulee: { txt: 'Annulée', cls: 'tag tag--off' }, expiree: { txt: 'Sans chauffeur', cls: 'tag tag--off' },
  en_attente: { txt: 'En attente', cls: 'tag tag--wait' }, assignee: { txt: 'Acceptée', cls: 'tag tag--go' }, en_cours: { txt: 'En cours', cls: 'tag tag--go' },
  en_attente_devis: { txt: 'Devis attendu', cls: 'tag tag--wait' }, devis_envoye: { txt: 'Devis envoyé', cls: 'tag tag--go' },
  approuvee: { txt: 'Validée', cls: 'tag tag--go' }, en_livraison: { txt: 'En livraison', cls: 'tag tag--go' },
};

@Component({
  selector: 'app-historique',
  standalone: true,
  imports: [DatePipe],
  template: `
<section class="page">
  <div class="container" style="max-width:900px">
    <header class="page-head"><div><h1>Historique</h1><p>Vos courses, livraisons et paiements.</p></div></header>

    <div class="tabs" role="tablist">
      <button class="tab" [class.tab--active]="tab() === 'courses'" (click)="tab.set('courses')" role="tab">Courses</button>
      <button class="tab" [class.tab--active]="tab() === 'livraisons'" (click)="tab.set('livraisons')" role="tab">Livraisons</button>
      <button class="tab" [class.tab--active]="tab() === 'paiements'" (click)="tab.set('paiements')" role="tab">Paiements</button>
    </div>

    @if (loading()) { <div class="empty"><span class="pulse-dot"></span></div> }
    @else {
      <div class="card">
        @if (tab() === 'courses') {
          @for (r of rides(); track r.id) {
            <div class="list-item">
              <div class="stack" style="--gap:.25rem">
                <strong>{{ r.depart_label }} → {{ r.arrivee_label }}</strong>
                <span class="small muted">{{ r.created_at | date: 'd MMM y, HH:mm' }} · {{ cat(r.categorie) }} · {{ r.distance_km }} km · {{ r.client_id === uid ? 'en tant que passager' : 'en tant que chauffeur' }}</span>
              </div>
              <div class="stack" style="--gap:.3rem;align-items:flex-end"><span [class]="st(r.statut).cls">{{ st(r.statut).txt }}</span><span class="price" style="font-size:1.1rem">{{ fcfa(r.montant_offert ?? r.tarif_base) }}</span></div>
            </div>
          } @empty { <div class="empty"><i class="bi bi-car-front"></i><p>Aucune course.</p></div> }
        }
        @if (tab() === 'livraisons') {
          @for (d of deliveries(); track d.id) {
            <div class="list-item">
              <div class="stack" style="--gap:.25rem">
                <strong>{{ lt(d.type) }} → {{ d.livraison_label }}</strong>
                <span class="small muted">{{ d.created_at | date: 'd MMM y, HH:mm' }} · depuis {{ d.collecte_label }} · {{ d.client_id === uid ? 'commande' : d.chauffeur_id === uid ? 'livraison' : 'commerce' }}</span>
                @if (d.motif_annulation) { <span class="xs" style="color:var(--color-rust-deep)">{{ d.motif_annulation }}</span> }
              </div>
              <div class="stack" style="--gap:.3rem;align-items:flex-end"><span [class]="st(d.statut).cls">{{ st(d.statut).txt }}</span>
                @if (d.montant_livraison !== null) { <span class="price" style="font-size:1.1rem">{{ fcfa((d.montant_produits ?? 0) + d.montant_livraison) }}</span> }</div>
            </div>
          } @empty { <div class="empty"><i class="bi bi-box-seam"></i><p>Aucune livraison.</p></div> }
        }
        @if (tab() === 'paiements') {
          @for (p of payments(); track p.id) {
            <div class="list-item">
              <div class="stack" style="--gap:.25rem">
                <strong>{{ p.source_type === 'ride' ? 'Course' : p.source_type === 'trip' ? 'Trajet' : 'Livraison' }} · {{ p.categorie_montant }}</strong>
                <span class="small muted">{{ p.created_at | date: 'd MMM y, HH:mm' }} · {{ moyen(p.moyen) }}{{ p.reference_externe === 'SIMULATION' ? ' (simulé)' : '' }}</span>
              </div>
              <div class="stack" style="--gap:.2rem;align-items:flex-end">
                <span class="price" style="font-size:1.1rem" [style.color]="p.payeur_id === uid ? 'var(--color-rust-deep)' : 'var(--color-teal-deep)'">{{ p.payeur_id === uid ? '−' : '+' }} {{ fcfa(p.montant) }}</span>
                @if (p.beneficiaire_id === uid) { <span class="xs muted">net {{ fcfa(p.montant * (100 - p.commission_pct) / 100) }} après {{ p.commission_pct }} %</span> }
              </div>
            </div>
          } @empty { <div class="empty"><i class="bi bi-cash-coin"></i><p>Aucun paiement.</p></div> }
        }
      </div>
    }
  </div>
</section>
  `,
})
export class HistoriqueComponent implements OnInit {
  readonly fcfa = fcfa;
  readonly tab = signal<Tab>('courses');
  readonly loading = signal(true);
  readonly rides = signal<RideRequest[]>([]);
  readonly deliveries = signal<DeliveryOrder[]>([]);
  readonly payments = signal<Payment[]>([]);
  get uid() { return this.sb.uid; }

  constructor(private sb: SupabaseService, private toast: ToastService) {}

  async ngOnInit() {
    try {
      // Les règles RLS ne renvoient que les lignes où l'utilisateur est partie prenante.
      const [r, d, p] = await Promise.all([
        this.sb.client.from('ride_requests').select('*').order('created_at', { ascending: false }).limit(60),
        this.sb.client.from('delivery_orders').select('*').order('created_at', { ascending: false }).limit(60),
        this.sb.client.from('payments').select('*').order('created_at', { ascending: false }).limit(60),
      ]);
      for (const x of [r, d, p]) if (x.error) throw x.error;
      this.rides.set(r.data as RideRequest[]); this.deliveries.set(d.data as DeliveryOrder[]); this.payments.set(p.data as Payment[]);
    } catch (e) { this.toast.error(messageErreur(e)); }
    finally { this.loading.set(false); }
  }

  st(s: string) { return STATUT[s] ?? { txt: s, cls: 'tag' }; }
  cat(c: string) { return LIBELLES_CATEGORIE[c] ?? c; }
  lt(t: string) { return LIBELLES_LIVRAISON[t] ?? t; }
  moyen(m: string) { return LIBELLES_MOYEN[m] ?? m; }
}
