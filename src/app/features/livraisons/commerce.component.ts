import { DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DeliveryOrder, Merchant, TypeCommerce } from '../../core/models/models';
import { DeliveryService } from '../../core/services/delivery.service';
import { GeoService, Place } from '../../core/services/geo.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../core/services/toast.service';
import { LIBELLES_LIVRAISON, fcfa, messageErreur } from '../../core/util/format';
import { Solde } from '../../core/models/models';
import { PaymentsService } from '../../core/services/payments.service';
import { MapComponent, MapMarker } from '../../shared/map/map.component';
import { PlaceFieldComponent } from '../../shared/place-field/place-field.component';

interface LigneForm { libelle: string; prix: number | null }

const STATUTS: Record<string, { txt: string; cls: string }> = {
  en_attente_devis: { txt: 'Devis à établir', cls: 'tag tag--wait' },
  devis_envoye: { txt: 'Devis envoyé — en attente du client', cls: 'tag tag--go' },
  approuvee: { txt: 'Validée — recherche d’un livreur', cls: 'tag tag--ok' },
  en_livraison: { txt: 'Récupérée par le livreur', cls: 'tag tag--go' },
  livree: { txt: 'Livrée', cls: 'tag tag--ok' },
  annulee: { txt: 'Annulée', cls: 'tag tag--off' },
};

@Component({
  selector: 'app-commerce',
  standalone: true,
  imports: [FormsModule, DatePipe, MapComponent, PlaceFieldComponent],
  template: `
<section class="page">
  <div class="container">
    <header class="page-head">
      <div><h1>Espace commerçant</h1><p>Recevez les commandes de vos clients proches, envoyez vos devis, et faites-vous livrer.</p></div>
    </header>

    @if (!estCommercant()) {
      <div class="alert alert--warn"><i class="bi bi-lock"></i><p>Cet espace est réservé aux comptes <strong>commerçant</strong>.</p></div>
    } @else if (loading()) {
      <div class="empty"><span class="pulse-dot"></span></div>
    } @else if (!merchant()) {
      <div class="cols-2 cols-2--form">
        <form class="card stack stack--lg" (ngSubmit)="createMerchant()">
          <h2>Déclarez votre commerce</h2>
          <div class="field">
            <label for="ctype">Type de commerce</label>
            <select id="ctype" (change)="ctype.set($any($event.target).value)">
              <option value="pharmacie">Pharmacie</option><option value="restaurant">Restaurant</option><option value="marche">Marché / boutique</option>
            </select>
          </div>
          <div class="field"><label for="cnom">Nom du commerce</label><input id="cnom" name="cnom" [ngModel]="cnom()" (ngModelChange)="cnom.set($event)" placeholder="Pharmacie Liberté" required></div>
          <app-place-field label="Adresse" icon="bi-shop" [place]="cplace()" (placeChange)="cplace.set($event)" />
          <span class="field-hint">Vous pouvez aussi cliquer sur la carte pour placer précisément votre commerce.</span>
          <button class="btn btn--gold" type="submit" [disabled]="busy()">Enregistrer mon commerce</button>
        </form>
        <div class="map-box map-box--tall"><app-map [markers]="formMarkers()" [clickable]="true" [fitKey]="fitKey()" (mapClick)="pickOnMap($event.lat, $event.lng)" /></div>
      </div>
    } @else {
      <div class="stack stack--lg">
        <div class="card row row--between">
          <div><strong style="font-size:1.15rem">{{ merchant()!.nom_commerce }}</strong>
            <div class="small muted">{{ typeLabel(merchant()!.type) }}</div></div>
          <span [class]="merchant()!.statut_verif === 'verifie' ? 'tag tag--ok' : 'tag tag--wait'">{{ merchant()!.statut_verif === 'verifie' ? 'Commerce vérifié' : 'Vérification en attente' }}</span>
        </div>

        @if (solde(); as so) {
          <div class="card row row--between" style="align-items:flex-start">
            <div><span class="xs muted">À recevoir de Yobbalema (produits payés en ligne, net de 5 % de commission)</span>
              <div class="price">{{ fcfa(so.a_verser) }}</div>
              <span class="xs muted">Déjà versé : {{ fcfa(so.deja_verse) }}@if (so.en_attente_de_paiement > 0) { · en attente de paiement client : {{ fcfa(so.en_attente_de_paiement) }} }</span></div>
            <p class="xs muted mb-0" style="max-width:340px">Le client paie en ligne ; Yobbalema vous reverse ensuite le montant des produits. Vous serez notifié à chaque versement.</p>
          </div>
        }

        <h2 style="font-size:var(--text-xl)">À traiter ({{ aTraiter().length }})</h2>
        @for (o of aTraiter(); track o.id) {
          <article class="card stack" style="--gap:.9rem;border-color:var(--color-gold-deep)">
            <div class="row row--between">
              <div class="row" style="gap:.6rem"><span class="tag tag--go">{{ libelle(o.type) }}</span><span [class]="st(o.statut).cls">{{ st(o.statut).txt }}</span></div>
              <span class="xs muted">{{ o.created_at | date: 'HH:mm' }}</span>
            </div>
            <dl class="kv"><dt>Livrer à</dt><dd>{{ o.livraison_label }}</dd>
              @if (o.description) { <dt>Commande</dt><dd>{{ o.description }}</dd> }</dl>
            @if (o.photo_ordonnance_url) {
              <div><button class="btn btn--outline btn--sm" (click)="openPrescription(o)"><i class="bi bi-file-earmark-medical"></i> Voir l’ordonnance</button></div>
            }

            @if (openId() === o.id) {
              <div class="stack" style="background:var(--color-paper-raised);padding:1rem;border-radius:var(--radius-md)">
                <strong class="small">Devis : prix de chaque article</strong>
                @for (l of lignes(); track $index) {
                  <div class="row" style="flex-wrap:nowrap">
                    <input style="flex:2;min-width:0" class="lig" [attr.aria-label]="'Article ' + ($index + 1)" placeholder="Article" [ngModel]="l.libelle" (ngModelChange)="setLigne($index, 'libelle', $event)" [ngModelOptions]="{standalone: true}">
                    <input style="flex:1;min-width:0" class="lig" type="number" min="0" step="25" placeholder="Prix" [attr.aria-label]="'Prix ' + ($index + 1)" [ngModel]="l.prix" (ngModelChange)="setLigne($index, 'prix', $event)" [ngModelOptions]="{standalone: true}">
                    <button type="button" class="btn btn--danger btn--sm" (click)="removeLigne($index)" [disabled]="lignes().length === 1" aria-label="Retirer la ligne"><i class="bi bi-x-lg"></i></button>
                  </div>
                }
                <div><button type="button" class="btn btn--outline btn--sm" (click)="addLigne()"><i class="bi bi-plus-lg"></i> Ajouter un article</button></div>
                <div class="row" style="align-items:flex-end">
                  <div class="field" style="flex:1"><label for="liv">Prix de la livraison (FCFA)</label><input id="liv" type="number" min="0" step="25" [ngModel]="livraisonPrix()" (ngModelChange)="livraisonPrix.set($event)" [ngModelOptions]="{standalone: true}"></div>
                  <div><span class="xs muted">Total client</span><div class="price">{{ fcfa(totalProduits() + (+livraisonPrix() || 0)) }}</div></div>
                </div>
                <div class="field"><label for="note">Note pour le client (facultatif)</label><input id="note" [ngModel]="note()" (ngModelChange)="note.set($event)" [ngModelOptions]="{standalone: true}" placeholder="Prêt dans 10 minutes"></div>
                <p class="xs muted mb-0">Sur les produits, Yobbalema prélève 5 % chez vous (jamais chez le client).</p>
                <div class="row">
                  <button class="btn btn--gold" (click)="sendQuote(o)" [disabled]="busy()"><i class="bi bi-send"></i> Envoyer le devis</button>
                  <button class="btn btn--outline btn--sm" (click)="openId.set(null)">Fermer</button>
                </div>
              </div>
            } @else {
              <div class="row">
                <button class="btn btn--gold" (click)="openQuote(o)"><i class="bi bi-receipt"></i> {{ o.statut === 'devis_envoye' ? 'Modifier le devis' : 'Établir le devis' }}</button>
                <button class="btn btn--danger btn--sm" (click)="refuse(o)" [disabled]="busy()">Refuser</button>
              </div>
            }
          </article>
        } @empty { <div class="card empty"><i class="bi bi-inbox"></i><p>Aucune commande à traiter.</p></div> }

        @if (suivi().length) {
          <h2 style="font-size:var(--text-xl)">Suivi</h2>
          <div class="card">
            @for (o of suivi(); track o.id) {
              <div class="list-item">
                <div><span class="tag tag--go">{{ libelle(o.type) }}</span> <span class="small">→ {{ o.livraison_label }}</span>
                  <div class="xs muted">{{ o.created_at | date: 'd MMM, HH:mm' }} · {{ fcfa(o.montant_produits) }} de produits</div></div>
                <span [class]="st(o.statut).cls">{{ st(o.statut).txt }}</span>
              </div>
            }
          </div>
        }
      </div>
    }
  </div>
</section>
  `,
  styles: [`.lig { padding: 0.6em 0.8em; border: 1.5px solid var(--color-paper-line); border-radius: var(--radius-sm); font: inherit; font-size: var(--text-sm); background: var(--color-white); width: 100%; }`],
})
export class CommerceComponent implements OnInit, OnDestroy {
  readonly fcfa = fcfa;
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly merchant = signal<Merchant | null>(null);
  readonly orders = signal<DeliveryOrder[]>([]);
  readonly solde = signal<Solde | null>(null);

  readonly ctype = signal<TypeCommerce>('pharmacie');
  readonly cnom = signal('');
  readonly cplace = signal<Place | null>(null);
  readonly fitKey = signal(0);

  readonly openId = signal<string | null>(null);
  readonly lignes = signal<LigneForm[]>([{ libelle: '', prix: null }]);
  readonly livraisonPrix = signal<number | string>(700);
  readonly note = signal('');

  readonly estCommercant = computed(() => this.sb.currentProfile()?.role === 'commercant');
  readonly aTraiter = computed(() => this.orders().filter((o) => o.statut === 'en_attente_devis' || o.statut === 'devis_envoye'));
  readonly suivi = computed(() => this.orders().filter((o) => !['en_attente_devis', 'devis_envoye'].includes(o.statut)));
  readonly totalProduits = computed(() => this.lignes().reduce((s, l) => s + (Number(l.prix) || 0), 0));
  readonly formMarkers = computed<MapMarker[]>(() => {
    const p = this.cplace();
    return p ? [{ id: 'c', lat: p.lat, lng: p.lng, icon: 'bi-shop', color: '#0F766E', label: 'Votre commerce' }] : [];
  });

  private timer?: ReturnType<typeof setInterval>;
  private unwatch?: () => void;

  constructor(private svc: DeliveryService, private geo: GeoService, private sb: SupabaseService, private toast: ToastService, private payments: PaymentsService) {}

  async ngOnInit() {
    if (this.estCommercant()) {
      try {
        this.merchant.set(await this.svc.myMerchant());
        if (this.merchant()) { await this.loadOrders(); this.solde.set(await this.payments.solde().catch(() => null)); }
      } catch (e) { this.toast.error(messageErreur(e)); }
      this.timer = setInterval(() => { if (this.merchant()) this.loadOrders(); }, 5000);
      this.unwatch = this.sb.watch('delivery_orders', undefined, () => { if (this.merchant()) this.loadOrders(); });
    }
    this.loading.set(false);
  }
  ngOnDestroy() { clearInterval(this.timer); this.unwatch?.(); }

  st(s: string) { return STATUTS[s] ?? { txt: s, cls: 'tag' }; }
  libelle(t: string) { return LIBELLES_LIVRAISON[t] ?? t; }
  typeLabel(t: TypeCommerce) { return t === 'pharmacie' ? 'Pharmacie' : t === 'restaurant' ? 'Restaurant' : 'Marché / boutique'; }

  async pickOnMap(lat: number, lng: number) {
    const label = await this.geo.reverse(lat, lng);
    this.cplace.set({ label, lat, lng }); this.fitKey.update((k) => k + 1);
  }

  async createMerchant() {
    const p = this.cplace();
    if (!p || !this.cnom().trim()) { this.toast.error('Indiquez le nom et l’adresse de votre commerce.'); return; }
    this.busy.set(true);
    try {
      this.merchant.set(await this.svc.createMerchant({ type: this.ctype(), nom_commerce: this.cnom().trim(), lat: p.lat, lng: p.lng }));
      this.toast.ok('Commerce enregistré. Il sera proposé aux clients proches après vérification.');
    } catch (e) { this.toast.error(messageErreur(e)); } finally { this.busy.set(false); }
  }

  async loadOrders() {
    const m = this.merchant(); if (!m) return;
    try { this.orders.set(await this.svc.merchantOrders(m.id)); } catch (e) { console.warn('chargement commandes commerçant', e); }
  }

  // ----- devis -----
  openQuote(o: DeliveryOrder) {
    this.openId.set(o.id);
    this.lignes.set(o.devis_lignes?.length ? o.devis_lignes.map((l) => ({ libelle: l.libelle, prix: l.prix })) : [{ libelle: '', prix: null }]);
    this.livraisonPrix.set(o.montant_livraison ?? 700);
    this.note.set(o.devis_note ?? '');
  }
  setLigne(i: number, k: 'libelle' | 'prix', v: string | number | null) {
    this.lignes.update((ls) => ls.map((l, idx) => (idx === i ? { ...l, [k]: k === 'prix' ? (v === '' || v === null ? null : Number(v)) : String(v ?? '') } : l)));
  }
  addLigne() { this.lignes.update((ls) => [...ls, { libelle: '', prix: null }]); }
  removeLigne(i: number) { this.lignes.update((ls) => ls.filter((_, idx) => idx !== i)); }

  async openPrescription(o: DeliveryOrder) {
    const url = await this.svc.signedUrl('ordonnances', o.photo_ordonnance_url!);
    if (url) window.open(url, '_blank', 'noopener');
    else this.toast.error('Impossible d’ouvrir l’ordonnance.');
  }

  async sendQuote(o: DeliveryOrder) {
    const lignes = this.lignes().filter((l) => l.libelle.trim() && l.prix !== null && l.prix >= 0).map((l) => ({ libelle: l.libelle.trim(), prix: Number(l.prix) }));
    if (!lignes.length) { this.toast.error('Ajoutez au moins un article avec son prix.'); return; }
    this.busy.set(true);
    try {
      await this.svc.sendQuote(o.id, lignes, Number(this.livraisonPrix()) || 0, this.note().trim() || null);
      this.toast.ok('Devis envoyé au client.'); this.openId.set(null); await this.loadOrders();
    } catch (e) { this.toast.error(messageErreur(e)); } finally { this.busy.set(false); }
  }

  async refuse(o: DeliveryOrder) {
    if (!confirm('Refuser cette commande ?')) return;
    this.busy.set(true);
    try { await this.svc.refuse(o.id); this.toast.info('Commande refusée.'); await this.loadOrders(); }
    catch (e) { this.toast.error(messageErreur(e)); } finally { this.busy.set(false); }
  }
}
