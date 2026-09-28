import { DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DeliveryOrder, DriverLocation, PricingConfig, TypeLivraison, VehiculeLivraison } from '../../core/models/models';
import { DriverService } from '../../core/services/driver.service';
import { PayButtonsComponent } from '../../shared/pay-buttons/pay-buttons.component';
import { StarsComponent } from '../../shared/stars/stars.component';
import { DeliveryService } from '../../core/services/delivery.service';
import { GeoService, Place, RouteInfo } from '../../core/services/geo.service';
import { ProfileService, RelatedProfile } from '../../core/services/profile.service';
import { RidesService } from '../../core/services/rides.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../core/services/toast.service';
import { LIBELLES_LIVRAISON, fcfa, messageErreur } from '../../core/util/format';
import { MapComponent, MapMarker, MapRoute } from '../../shared/map/map.component';
import { PlaceFieldComponent } from '../../shared/place-field/place-field.component';

const TYPES: { id: TypeLivraison; nom: string; desc: string; icon: string }[] = [
  { id: 'colis', nom: 'Colis', desc: 'D’un point A à un point B', icon: 'bi-box-seam' },
  { id: 'pharmacie', nom: 'Pharmacie', desc: 'Envoyez votre ordonnance', icon: 'bi-capsule' },
  { id: 'repas', nom: 'Repas', desc: 'Restaurant partenaire', icon: 'bi-cup-hot' },
  { id: 'marche', nom: 'Marché', desc: 'Vos courses du marché', icon: 'bi-basket' },
];

const STATUTS: Record<string, { txt: string; cls: string }> = {
  en_attente_devis: { txt: 'En attente du devis du commerçant', cls: 'tag tag--wait' },
  devis_envoye: { txt: 'Devis reçu — à valider', cls: 'tag tag--go' },
  approuvee: { txt: 'Recherche d’un livreur…', cls: 'tag tag--wait' },
  en_livraison: { txt: 'En cours de livraison', cls: 'tag tag--go' },
  livree: { txt: 'Livrée', cls: 'tag tag--ok' },
  annulee: { txt: 'Annulée', cls: 'tag tag--off' },
};

@Component({
  selector: 'app-livraisons',
  standalone: true,
  imports: [FormsModule, DatePipe, MapComponent, PlaceFieldComponent, StarsComponent, PayButtonsComponent],
  template: `
<section class="page">
  <div class="container">
    <header class="page-head">
      <div><h1>Livraison</h1><p>Colis, médicaments, repas ou courses du marché, livrés chez vous.</p></div>
    </header>

    <div class="tabs" role="tablist">
      <button class="tab" [class.tab--active]="tab() === 'nouvelle'" (click)="tab.set('nouvelle')" role="tab">Nouvelle livraison</button>
      <button class="tab" [class.tab--active]="tab() === 'commandes'" (click)="tab.set('commandes')" role="tab">
        Mes commandes @if (aValider() > 0) { <span class="tag tag--wait" style="margin-left:.4rem">{{ aValider() }} à valider</span> }
      </button>
    </div>

    @if (tab() === 'nouvelle') {
      <div class="cols-2 cols-2--form">
        <form class="card stack stack--lg" (ngSubmit)="submit()">
          <div class="choice-grid">
            @for (t of types; track t.id) {
              <div class="choice">
                <input type="radio" name="type" [id]="'t-' + t.id" [checked]="type() === t.id" (change)="setType(t.id)">
                <label [attr.for]="'t-' + t.id"><span class="choice__title"><i class="bi" [class]="t.icon"></i> {{ t.nom }}</span><span class="choice__sub">{{ t.desc }}</span></label>
              </div>
            }
          </div>

          @if (type() === 'colis') {
            <app-place-field label="Adresse de collecte" icon="bi-geo-alt-fill" [place]="collecte()" (placeChange)="setCollecte($event)" />
            <app-place-field label="Adresse de livraison" icon="bi-flag-fill" [place]="livraison()" (placeChange)="setLivraison($event)" />
            <div class="row">
              <button type="button" class="btn btn--outline btn--sm" [class.btn--ink]="pick() === 'collecte'" (click)="togglePick('collecte')"><i class="bi bi-cursor"></i> Placer la collecte sur la carte</button>
              <button type="button" class="btn btn--outline btn--sm" [class.btn--ink]="pick() === 'livraison'" (click)="togglePick('livraison')"><i class="bi bi-cursor"></i> Placer la livraison</button>
            </div>
            <div class="field">
              <label for="veh">Véhicule souhaité</label>
              <select id="veh" (change)="vehicule.set($any($event.target).value || null)">
                <option value="">Peu importe</option>
                <option value="moto">Moto</option><option value="jakarta">Jakarta</option>
                <option value="tiak_tiak">Tiak-tiak</option><option value="voiture">Voiture</option>
              </select>
            </div>
            <div class="field"><label for="desc">Contenu du colis</label><input id="desc" name="desc" [ngModel]="description()" (ngModelChange)="description.set($event)" placeholder="Ex. Documents, carton de 3 kg…"></div>
            @if (estimation() !== null) {
              <div class="alert alert--info"><i class="bi bi-cash-coin"></i><p>Prix estimé : <strong>{{ fcfa(estimation()) }}</strong> ({{ route()?.distanceKm?.toString()?.replace('.', ',') }} km)</p></div>
            }
          } @else {
            <app-place-field label="Adresse de livraison" icon="bi-house-fill" [place]="livraison()" (placeChange)="setLivraison($event)" />
            <div><button type="button" class="btn btn--outline btn--sm" [class.btn--ink]="pick() === 'livraison'" (click)="togglePick('livraison')"><i class="bi bi-cursor"></i> Placer sur la carte</button></div>
            @if (type() === 'pharmacie') {
              <div class="field">
                <label for="ordo">Photo de l’ordonnance</label>
                <input id="ordo" type="file" accept="image/*,application/pdf" (change)="onFile($any($event.target).files?.[0] ?? null)">
                <span class="field-hint">Image ou PDF, 5 Mo maximum. Seule la pharmacie concernée peut la voir.</span>
              </div>
            }
            <div class="field">
              <label for="desc2">{{ type() === 'pharmacie' ? 'Précisions (facultatif)' : 'Votre commande' }}</label>
              <textarea id="desc2" name="desc2" [ngModel]="description()" (ngModelChange)="description.set($event)"
                        [placeholder]="type() === 'repas' ? 'Ex. 2 thiéboudienne, 1 bissap' : type() === 'marche' ? 'Ex. 2 kg de tomates, 1 kg d’oignons…' : 'Ex. Urgent, allergique à la pénicilline'"></textarea>
            </div>
            <div class="alert alert--info"><i class="bi bi-info-circle"></i>
              <p>Le partenaire le plus proche de votre adresse vous enverra un <strong>devis</strong> (prix des articles + livraison). Vous validez avant tout paiement. Règlement en ligne (Wave / Orange Money).</p></div>
          }

          <button class="btn btn--gold" type="submit" [disabled]="busy()">@if (busy()) { Envoi… } @else { <i class="bi bi-send"></i> {{ type() === 'colis' ? 'Demander un livreur' : 'Demander un devis' }} }</button>
        </form>

        <div class="stack">
          <div class="map-box map-box--tall"><app-map [markers]="markers()" [routes]="routes()" [clickable]="!!pick()" [fitKey]="fitKey()" (mapClick)="onMapClick($event)" /></div>
          @if (pick()) { <div class="alert alert--warn"><i class="bi bi-cursor"></i><p>Cliquez sur la carte pour placer {{ pick() === 'collecte' ? 'la collecte' : 'la livraison' }}.</p></div> }
        </div>
      </div>
    } @else {
      <div class="stack">
        @if (tracking(); as t) {
          <div class="card stack" style="--gap:.7rem;border-color:var(--color-teal)">
            <span class="tag tag--ok" style="align-self:flex-start"><i class="bi bi-bicycle"></i> Votre livreur est en route</span>
            <div class="map-box map-box--short"><app-map [markers]="trackMarkers()" [fitKey]="t.order.id + (t.pos ? 'p' : '')" /></div>
            @if (trackEta(); as e) { <p class="small mb-0">{{ e.perime ? 'Position du livreur non actualisée.' : 'Le livreur est à environ ' + e.km.toFixed(1).replace('.', ',') + ' km de chez vous (≈ ' + e.min + ' min).' }}</p> }
            @else { <p class="small muted mb-0">Position du livreur bientôt disponible.</p> }
          </div>
        }
        @for (o of orders(); track o.id) {
          <article class="card stack" style="--gap:.8rem">
            <div class="row row--between">
              <div class="row" style="gap:.6rem">
                <span class="tag tag--go">{{ libelleType(o.type) }}</span>
                <span [class]="st(o.statut).cls">{{ st(o.statut).txt }}</span>
              </div>
              <span class="xs muted">{{ o.created_at | date: 'd MMM, HH:mm' }}</span>
            </div>
            <dl class="kv">
              @if (o.merchant_id) { <dt>Partenaire</dt><dd>{{ o.collecte_label }}</dd> }
              @else { <dt>Collecte</dt><dd>{{ o.collecte_label }}</dd> }
              <dt>Livraison</dt><dd>{{ o.livraison_label }}</dd>
              @if (o.description) { <dt>Détail</dt><dd>{{ o.description }}</dd> }
            </dl>

            @if (o.devis_lignes?.length) {
              <div class="card card--flat stack" style="--gap:.35rem">
                <strong class="small">Devis du partenaire</strong>
                @for (l of o.devis_lignes; track $index) { <div class="row row--between small"><span>{{ l.libelle }}</span><span>{{ fcfa(l.prix) }}</span></div> }
                <div class="row row--between small" style="border-top:1px dashed var(--color-paper-line);padding-top:.4rem"><span>Sous-total produits</span><strong>{{ fcfa(o.montant_produits) }}</strong></div>
                <div class="row row--between small"><span>Livraison</span><strong>{{ fcfa(o.montant_livraison) }}</strong></div>
                <div class="row row--between"><strong>Total</strong><span class="price">{{ fcfa((o.montant_produits ?? 0) + (o.montant_livraison ?? 0)) }}</span></div>
                @if (o.devis_note) { <p class="xs muted mb-0">Note : {{ o.devis_note }}</p> }
              </div>
            } @else if (!o.merchant_id && o.montant_livraison) {
              <div class="row row--between"><span class="small">Prix de la livraison</span><span class="price">{{ fcfa(o.montant_livraison) }}</span></div>
            }

            @if (o.statut === 'en_livraison' && livreurs().get(o.chauffeur_id ?? ''); as l) {
              <div class="alert alert--ok"><i class="bi bi-bicycle"></i><p>Votre livreur : <strong>{{ l.prenom }} {{ l.nom }}</strong>
                @if (l.telephone) { — <a [href]="'tel:' + l.telephone" class="strong">{{ l.telephone }}</a> }</p></div>
            }

            @if (o.statut === 'annulee' && o.motif_annulation) {
              <div class="alert alert--error"><i class="bi bi-x-octagon"></i><p>{{ o.motif_annulation }}</p></div>
            }

            @if (o.statut === 'livree') {
              <app-pay-buttons source="delivery" [sourceId]="o.id" />
              <div class="card card--flat stack" style="--gap:.6rem">
                @if (!isReviewed('delivery', o.id)) {
                  <div class="row row--between"><span class="small strong">Noter le livreur</span>
                    <app-stars [value]="noteFor('delivery', o.id)" (valueChange)="setNote('delivery', o.id, $event)" />
                    <button class="btn btn--ink btn--sm" (click)="review('delivery', o)" [disabled]="acting() === o.id">Envoyer</button></div>
                } @else { <span class="small muted"><i class="bi bi-check2"></i> Livreur noté</span> }
                @if (o.merchant_id) {
                  @if (!isReviewed('commerce', o.id)) {
                    <div class="row row--between"><span class="small strong">Noter le partenaire</span>
                      <app-stars [value]="noteFor('commerce', o.id)" (valueChange)="setNote('commerce', o.id, $event)" />
                      <button class="btn btn--ink btn--sm" (click)="review('commerce', o)" [disabled]="acting() === o.id">Envoyer</button></div>
                  } @else { <span class="small muted"><i class="bi bi-check2"></i> Partenaire noté</span> }
                }
              </div>
            }

            <div class="row">
              @if (o.statut === 'devis_envoye') { <button class="btn btn--teal" (click)="approve(o)" [disabled]="acting() === o.id"><i class="bi bi-check2-circle"></i> Valider le devis</button> }
              @if (['en_attente_devis', 'devis_envoye', 'approuvee'].includes(o.statut)) { <button class="btn btn--danger btn--sm" (click)="cancel(o)" [disabled]="acting() === o.id">Annuler</button> }
            </div>
          </article>
        } @empty {
          <div class="card empty"><i class="bi bi-box-seam"></i><p>Aucune commande pour le moment.</p></div>
        }
      </div>
    }
  </div>
</section>
  `,
})
export class LivraisonsComponent implements OnInit, OnDestroy {
  readonly types = TYPES;
  readonly fcfa = fcfa;
  readonly tab = signal<'nouvelle' | 'commandes'>('nouvelle');
  readonly busy = signal(false);
  readonly acting = signal<string | null>(null);

  readonly type = signal<TypeLivraison>('colis');
  readonly collecte = signal<Place | null>(null);
  readonly livraison = signal<Place | null>(null);
  readonly route = signal<RouteInfo | null>(null);
  readonly vehicule = signal<VehiculeLivraison | null>(null);
  readonly description = signal('');
  readonly file = signal<File | null>(null);
  readonly fitKey = signal(0);
  readonly pick = signal<'collecte' | 'livraison' | null>(null);
  readonly pricing = signal<PricingConfig[]>([]);
  readonly tarifMin = signal(500);

  readonly orders = signal<DeliveryOrder[]>([]);
  readonly livreurs = signal<Map<string, RelatedProfile>>(new Map());
  readonly reviewed = signal<Set<string>>(new Set());
  readonly notes = signal<Record<string, number>>({});
  readonly tracking = signal<{ order: DeliveryOrder; pos: DriverLocation | null } | null>(null);
  readonly now = signal(Date.now());

  readonly trackMarkers = computed<MapMarker[]>(() => {
    const t = this.tracking(); if (!t) return [];
    const m: MapMarker[] = [{ id: 'l', lat: t.order.livraison_lat, lng: t.order.livraison_lng, icon: 'bi-house-fill', color: '#C1442E', label: 'Chez vous' }];
    if (t.pos) m.push({ id: 'p', lat: t.pos.lat, lng: t.pos.lng, icon: 'bi-bicycle', color: '#F0A93C', shape: 'round', label: 'Votre livreur' });
    return m;
  });
  readonly trackEta = computed(() => {
    const t = this.tracking(); if (!t?.pos) return null;
    const km = this.geo.haversineKm(t.pos, { lat: t.order.livraison_lat, lng: t.order.livraison_lng }) * 1.3;
    return { km, min: Math.max(1, Math.round((km / 20) * 60)), perime: (this.now() - new Date(t.pos.updated_at).getTime()) / 1000 > 60 };
  });

  readonly aValider = computed(() => this.orders().filter((o) => o.statut === 'devis_envoye').length);
  readonly estimation = computed(() => {
    const r = this.route(); const base = this.pricing().find((p) => p.categorie === 'standard')?.tarif_km_base;
    return r && base ? Math.max(this.tarifMin(), Math.round((r.distanceKm * Number(base)) / 25) * 25) : null;
  });
  readonly markers = computed<MapMarker[]>(() => {
    const m: MapMarker[] = []; const c = this.collecte(); const l = this.livraison();
    if (c && this.type() === 'colis') m.push({ id: 'c', lat: c.lat, lng: c.lng, icon: 'bi-box-seam-fill', color: '#0F766E', label: 'Collecte' });
    if (l) m.push({ id: 'l', lat: l.lat, lng: l.lng, icon: 'bi-house-fill', color: '#C1442E', label: 'Livraison' });
    return m;
  });
  readonly routes = computed<MapRoute[]>(() => (this.route() && this.type() === 'colis' ? [{ points: this.route()!.geometry }] : []));

  private timer?: ReturnType<typeof setInterval>;
  private clock?: ReturnType<typeof setInterval>;
  private unwatch?: () => void;

  constructor(
    private svc: DeliveryService, private geo: GeoService, private rides: RidesService, private profiles: ProfileService,
    private sb: SupabaseService, private toast: ToastService, private driverSvc: DriverService,
  ) {}

  async ngOnInit() {
    try {
      this.pricing.set(await this.rides.pricing());
      this.tarifMin.set((await this.rides.settings()).tarifMinimum);
    } catch { /* estimation indisponible, non bloquant */ }
    await this.loadOrders();
    this.timer = setInterval(() => this.loadOrders(), 5000);
    this.clock = setInterval(() => this.now.set(Date.now()), 1000);
    this.unwatch = this.sb.watch('delivery_orders', `client_id=eq.${this.sb.uid}`, () => this.loadOrders());
  }
  ngOnDestroy() { clearInterval(this.timer); clearInterval(this.clock); this.unwatch?.(); }

  st(s: string) { return STATUTS[s] ?? { txt: s, cls: 'tag' }; }
  libelleType(t: string) { return LIBELLES_LIVRAISON[t] ?? t; }

  setType(t: TypeLivraison) { this.type.set(t); this.file.set(null); this.route.set(null); this.fitKey.update((k) => k + 1); if (t === 'colis') this.updateRoute(); }
  onFile(f: File | null) {
    if (f && f.size > 5 * 1024 * 1024) { this.toast.error('Fichier trop volumineux (5 Mo maximum).'); this.file.set(null); return; }
    this.file.set(f);
  }
  togglePick(w: 'collecte' | 'livraison') { this.pick.set(this.pick() === w ? null : w); }
  async onMapClick(pos: { lat: number; lng: number }) {
    const which = this.pick(); if (!which) return;
    this.pick.set(null);
    const place = { label: await this.geo.reverse(pos.lat, pos.lng), lat: pos.lat, lng: pos.lng };
    if (which === 'collecte') await this.setCollecte(place); else await this.setLivraison(place);
  }
  async setCollecte(p: Place | null) { this.collecte.set(p); await this.updateRoute(); }
  async setLivraison(p: Place | null) { this.livraison.set(p); await this.updateRoute(); }
  private async updateRoute() {
    const c = this.collecte(); const l = this.livraison();
    this.route.set(this.type() === 'colis' && c && l ? await this.geo.route(c, l) : null);
    this.fitKey.update((k) => k + 1);
  }

  async submit() {
    const t = this.type(); const l = this.livraison();
    if (!l) { this.toast.error('Indiquez l’adresse de livraison.'); return; }
    if (t === 'colis' && !this.collecte()) { this.toast.error('Indiquez l’adresse de collecte.'); return; }
    if (t === 'pharmacie' && !this.file()) { this.toast.error('Joignez la photo de votre ordonnance.'); return; }
    if ((t === 'repas' || t === 'marche') && this.description().trim().length < 3) { this.toast.error('Décrivez votre commande.'); return; }
    this.busy.set(true);
    try {
      const ordonnancePath = t === 'pharmacie' ? await this.svc.uploadPrescription(this.file()!) : null;
      await this.svc.create({
        type: t, livraison: l, collecte: t === 'colis' ? this.collecte() : null, distanceKm: this.route()?.distanceKm ?? null,
        description: this.description().trim() || null, ordonnancePath, vehicule: t === 'colis' ? this.vehicule() : null,
      });
      this.toast.ok(t === 'colis' ? 'Demande envoyée : un livreur va être trouvé.' : 'Demande envoyée : le partenaire vous répond avec un devis.');
      this.description.set(''); this.file.set(null); this.collecte.set(null); this.livraison.set(null); this.route.set(null);
      await this.loadOrders(); this.tab.set('commandes');
    } catch (e) { this.toast.error(messageErreur(e)); }
    finally { this.busy.set(false); }
  }

  async loadOrders() {
    try {
      const orders = await this.svc.myOrders();
      this.orders.set(orders);
      const enCours = orders.find((o) => o.statut === 'en_livraison' && o.chauffeur_id);
      this.tracking.set(enCours ? { order: enCours, pos: await this.driverSvc.locationOf(enCours.chauffeur_id!) } : null);
      this.reviewed.set(await this.svc.reviewedKeys(orders.filter((o) => o.statut === 'livree').map((o) => o.id)));
      const missing = orders.filter((o) => o.chauffeur_id && !this.livreurs().has(o.chauffeur_id)).map((o) => o.chauffeur_id!);
      if (missing.length) {
        const fetched = await Promise.all([...new Set(missing)].map((id) => this.profiles.related(id)));
        const next = new Map(this.livreurs()); fetched.forEach((p) => p && next.set(p.id, p)); this.livreurs.set(next);
      }
    } catch (e) { console.warn('chargement commandes', e); }
  }

  isReviewed(kind: 'delivery' | 'commerce', id: string) { return this.reviewed().has(`${kind}:${id}`); }
  noteFor(kind: string, id: string) { return this.notes()[`${kind}:${id}`] ?? 5; }
  setNote(kind: string, id: string, n: number) { this.notes.update((x) => ({ ...x, [`${kind}:${id}`]: n })); }
  async review(kind: 'delivery' | 'commerce', o: DeliveryOrder) {
    this.acting.set(o.id);
    try { await this.rides.rate(kind, o.id, this.noteFor(kind, o.id), null); this.toast.ok('Merci pour votre avis !'); await this.loadOrders(); }
    catch (e) { this.toast.error(messageErreur(e)); } finally { this.acting.set(null); }
  }

  async approve(o: DeliveryOrder) {
    this.acting.set(o.id);
    try { await this.svc.approve(o.id); this.toast.ok('Devis validé : nous cherchons un livreur.'); await this.loadOrders(); }
    catch (e) { this.toast.error(messageErreur(e)); } finally { this.acting.set(null); }
  }
  async cancel(o: DeliveryOrder) {
    this.acting.set(o.id);
    try { await this.svc.cancel(o.id); this.toast.info('Commande annulée.'); await this.loadOrders(); }
    catch (e) { this.toast.error(messageErreur(e)); } finally { this.acting.set(null); }
  }
}
