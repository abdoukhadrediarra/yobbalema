import { DatePipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MoyenPaiement } from '../../core/models/models';
import { ProfileService, RelatedProfile } from '../../core/services/profile.service';
import { RidesService } from '../../core/services/rides.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../core/services/toast.service';
import { ReservationWithTrip, TripWithReservations, TripsService } from '../../core/services/trips.service';
import { LIBELLES_MOYEN, fcfa, messageErreur } from '../../core/util/format';
import { PayButtonsComponent } from '../../shared/pay-buttons/pay-buttons.component';
import { StarsComponent } from '../../shared/stars/stars.component';

const STATUT_RES: Record<string, { txt: string; cls: string }> = {
  en_attente: { txt: 'En attente du chauffeur', cls: 'tag tag--wait' },
  confirmee: { txt: 'Confirmée', cls: 'tag tag--ok' },
  annulee: { txt: 'Annulée', cls: 'tag tag--off' },
};
const STATUT_TRIP: Record<string, { txt: string; cls: string }> = {
  ouvert: { txt: 'Ouvert', cls: 'tag tag--ok' },
  complet: { txt: 'Complet', cls: 'tag tag--go' },
  termine: { txt: 'Terminé', cls: 'tag tag--off' },
  annule: { txt: 'Annulé', cls: 'tag tag--bad' },
};

@Component({
  selector: 'app-mes-trajets',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe, StarsComponent, PayButtonsComponent],
  template: `
<section class="page">
  <div class="container">
    <header class="page-head">
      <div><h1>Mes trajets</h1><p>Vos réservations et, si vous êtes chauffeur, les trajets que vous conduisez.</p></div>
      <div class="row">
        <a routerLink="/trajets" class="btn btn--outline"><i class="bi bi-search"></i> Chercher un trajet</a>
        @if (estChauffeur()) { <a routerLink="/trajets/publier" class="btn btn--gold"><i class="bi bi-plus-lg"></i> Publier</a> }
      </div>
    </header>

    <div class="stack stack--lg">
      <div class="card">
        <h2>Mes réservations</h2>
        @for (r of reservations(); track r.id) {
          <div class="list-item">
            <div class="stack" style="--gap:.35rem;flex:1;min-width:230px">
              <strong>{{ r.trip.depart_label }} → {{ r.trip.arrivee_label }}</strong>
              <span class="small muted"><i class="bi bi-calendar-event"></i> {{ r.trip.date_heure_depart | date: "EEEE d MMMM 'à' HH'h'mm" }}</span>
              <span class="small">{{ r.nb_places }} place{{ r.nb_places > 1 ? 's' : '' }} · {{ fcfa(r.nb_places * r.trip.prix_place) }}
                @if (people().get(r.trip.driver_id); as d) { · Chauffeur : {{ d.prenom }} {{ d.nom }} }</span>
              @if (r.statut === 'confirmee' && people().get(r.trip.driver_id)?.telephone; as tel) {
                <a class="small strong" [href]="'tel:' + tel"><i class="bi bi-telephone"></i> {{ tel }}</a>
              }
            </div>
            <div class="stack" style="--gap:.5rem;align-items:flex-end">
              <span [class]="st(r.statut).cls">{{ r.trip.statut === 'annule' ? 'Trajet annulé' : st(r.statut).txt }}</span>
              @if (r.statut !== 'annulee' && (r.trip.statut === 'ouvert' || r.trip.statut === 'complet')) {
                <button class="btn btn--danger btn--sm" (click)="cancelReservation(r.id)" [disabled]="busy() === r.id">Annuler</button>
              }
              @if (r.statut === 'confirmee' && r.trip.statut === 'termine') { <app-pay-buttons source="trip" [sourceId]="r.id" /> }
              @if (r.statut === 'confirmee' && r.trip.statut === 'termine' && !reviewed().has(r.trip_id)) {
                <div class="stack" style="--gap:.4rem;align-items:flex-end">
                  <span class="xs muted">Notez ce trajet</span>
                  <app-stars [value]="notes()[r.trip_id] || 5" (valueChange)="setNote(r.trip_id, $event)" />
                  <button class="btn btn--ink btn--sm" (click)="rate(r.trip_id)" [disabled]="busy() === r.trip_id">Envoyer</button>
                </div>
              }
            </div>
          </div>
        } @empty {
          <div class="empty"><i class="bi bi-ticket-perforated"></i><p>Aucune réservation. <a routerLink="/trajets" class="strong">Trouver un trajet</a></p></div>
        }
      </div>

      @if (estChauffeur()) {
        <div class="card">
          <h2>Trajets que je conduis</h2>
          @for (t of trips(); track t.id) {
            <div class="list-item" style="display:block">
              <div class="row row--between" style="align-items:flex-start">
                <div class="stack" style="--gap:.3rem">
                  <strong style="font-size:1.1rem">{{ t.depart_label }} → {{ t.arrivee_label }}</strong>
                  <span class="small muted"><i class="bi bi-calendar-event"></i> {{ t.date_heure_depart | date: "EEEE d MMMM 'à' HH'h'mm" }} · {{ fcfa(t.prix_place) }} / place · {{ t.places_dispo }} place(s) libre(s)</span>
                </div>
                <div class="row">
                  <span [class]="stt(t.statut).cls">{{ stt(t.statut).txt }}</span>
                  @if (t.statut === 'ouvert' || t.statut === 'complet') {
                    <button class="btn btn--outline btn--sm" (click)="openEdit(t)">Modifier</button>
                    <button class="btn btn--teal btn--sm" (click)="finishTrip(t.id)" [disabled]="busy() === t.id">Terminer le trajet</button>
                    <button class="btn btn--danger btn--sm" (click)="cancelTrip(t.id)" [disabled]="busy() === t.id">Annuler</button>
                  }
                </div>
              </div>

              @if (editId() === t.id) {
                <div class="stack mt-1" style="background:var(--color-paper-raised);padding:1rem;border-radius:var(--radius-md)">
                  <div class="row" style="align-items:flex-end">
                    <div class="field"><label [attr.for]="'ep' + t.id">Prix par place</label><input [id]="'ep' + t.id" type="number" min="500" step="100" [ngModel]="ePrix()" (ngModelChange)="ePrix.set(+$event)" [ngModelOptions]="{standalone: true}" [disabled]="actives(t).length > 0"></div>
                    <div class="field"><label [attr.for]="'ed' + t.id">Départ</label><input [id]="'ed' + t.id" type="datetime-local" [ngModel]="eDate()" (ngModelChange)="eDate.set($event)" [ngModelOptions]="{standalone: true}" [disabled]="actives(t).length > 0"></div>
                    <div class="field"><label [attr.for]="'ee' + t.id">Places au total</label><input [id]="'ee' + t.id" type="number" min="1" max="8" [ngModel]="ePlaces()" (ngModelChange)="ePlaces.set(+$event)" [ngModelOptions]="{standalone: true}"></div>
                  </div>
                  @if (actives(t).length > 0) { <span class="field-hint">Des passagers ont réservé : le prix et la date ne peuvent plus changer (annulez le trajet pour le republier). Vous pouvez encore ajuster le nombre de places.</span> }
                  <div class="row"><button class="btn btn--gold btn--sm" (click)="saveEdit(t)" [disabled]="busy() === t.id">Enregistrer</button><button class="btn btn--outline btn--sm" (click)="editId.set(null)">Fermer</button></div>
                </div>
              }

              @if (actives(t).length) {
                <div class="stack mt-1" style="--gap:.6rem;background:var(--color-paper-raised);padding:.9rem 1rem;border-radius:var(--radius-md)">
                  @for (r of actives(t); track r.id) {
                    <div class="row row--between">
                      <div class="small">
                        <strong>{{ people().get(r.passager_id)?.prenom || 'Passager' }} {{ people().get(r.passager_id)?.nom }}</strong>
                        · {{ r.nb_places }} place{{ r.nb_places > 1 ? 's' : '' }} · {{ fcfa(r.nb_places * t.prix_place) }}
                        @if (people().get(r.passager_id)?.telephone; as tel) { · <a [href]="'tel:' + tel">{{ tel }}</a> }
                      </div>
                      <div class="row">
                        <span [class]="st(r.statut).cls">{{ st(r.statut).txt }}</span>
                        @if (r.statut === 'en_attente') {
                          <button class="btn btn--teal btn--sm" (click)="confirm(r.id)" [disabled]="busy() === r.id">Confirmer</button>
                          <button class="btn btn--danger btn--sm" (click)="cancelReservation(r.id)" [disabled]="busy() === r.id">Refuser</button>
                        }
                        @if (r.statut === 'confirmee' && t.statut === 'termine') {
                          @if (paid().has(r.id)) { <span class="tag tag--ok"><i class="bi bi-cash-coin"></i> Encaissé</span> }
                          @else {
                            <select style="padding:.45em .6em;border-radius:8px;border:1.5px solid var(--color-paper-line)" (change)="setMoyen(r.id, $any($event.target).value)" aria-label="Moyen de paiement">
                              @for (m of moyens; track m.id) { <option [value]="m.id">{{ m.nom }}</option> }
                            </select>
                            <button class="btn btn--gold btn--sm" (click)="collect(r.id, r.nb_places * t.prix_place)" [disabled]="busy() === r.id">Encaisser</button>
                          }
                        }
                      </div>
                    </div>
                  }
                </div>
              } @else { <p class="xs muted mt-1 mb-0">Aucune réservation pour l'instant.</p> }
            </div>
          } @empty {
            <div class="empty"><i class="bi bi-car-front"></i><p>Vous n'avez publié aucun trajet.</p></div>
          }
        </div>
      }
    </div>
  </div>
</section>
  `,
})
export class MesTrajetsComponent implements OnInit, OnDestroy {
  readonly fcfa = fcfa;
  readonly moyens: { id: MoyenPaiement; nom: string }[] = [
    { id: 'especes', nom: 'Espèces' }, { id: 'wave', nom: 'Wave' }, { id: 'orange_money', nom: 'Orange Money' },
  ];
  readonly busy = signal<string | null>(null);
  readonly reservations = signal<ReservationWithTrip[]>([]);
  readonly trips = signal<TripWithReservations[]>([]);
  readonly people = signal<Map<string, RelatedProfile>>(new Map());
  readonly paid = signal<Set<string>>(new Set());
  readonly reviewed = signal<Set<string>>(new Set());
  readonly notes = signal<Record<string, number>>({});
  readonly editId = signal<string | null>(null);
  readonly ePrix = signal(0);
  readonly eDate = signal('');
  readonly ePlaces = signal(1);
  private moyenChoisi = new Map<string, MoyenPaiement>();
  private timer?: ReturnType<typeof setInterval>;
  private unwatch: (() => void)[] = [];

  readonly estChauffeur = computed(() => this.sb.currentProfile()?.role === 'chauffeur');

  constructor(
    private svc: TripsService, private profiles: ProfileService, private rides: RidesService,
    private sb: SupabaseService, private toast: ToastService,
  ) {}

  async ngOnInit() {
    await this.load();
    this.timer = setInterval(() => this.load(), 8000);
    this.unwatch.push(this.sb.watch('reservations', undefined, () => this.load()));
  }
  ngOnDestroy() { clearInterval(this.timer); this.unwatch.forEach((u) => u()); }

  st(s: string) { return STATUT_RES[s] ?? { txt: s, cls: 'tag' }; }
  stt(s: string) { return STATUT_TRIP[s] ?? { txt: s, cls: 'tag' }; }
  actives(t: TripWithReservations) { return t.reservations.filter((r) => r.statut !== 'annulee'); }
  openEdit(t: TripWithReservations) {
    const confirmed = t.reservations.filter((r) => r.statut === 'confirmee').reduce((s, r) => s + r.nb_places, 0);
    this.ePrix.set(Number(t.prix_place));
    this.eDate.set(new Date(new Date(t.date_heure_depart).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16));
    this.ePlaces.set(t.places_dispo + confirmed);
    this.editId.set(t.id);
  }
  saveEdit(t: TripWithReservations) {
    return this.act(t.id, async () => { await this.svc.modify(t.id, this.ePrix(), new Date(this.eDate()).toISOString(), this.ePlaces()); this.editId.set(null); }, 'Trajet modifié.');
  }
  setNote(id: string, n: number) { this.notes.update((x) => ({ ...x, [id]: n })); }
  setMoyen(id: string, m: MoyenPaiement) { this.moyenChoisi.set(id, m); }

  async load() {
    try {
      const [res, trips] = await Promise.all([this.svc.myReservations(), this.estChauffeur() ? this.svc.myTrips() : Promise.resolve([])]);
      this.reservations.set(res); this.trips.set(trips);

      const ids = new Set<string>([
        ...res.map((r) => r.trip.driver_id),
        ...trips.flatMap((t) => t.reservations.map((r) => r.passager_id)),
      ]);
      const known = this.people();
      const missing = [...ids].filter((id) => !known.has(id) && id !== this.sb.uid);
      if (missing.length) {
        const fetched = await Promise.all(missing.map((id) => this.profiles.related(id)));
        const next = new Map(known);
        fetched.forEach((p) => p && next.set(p.id, p));
        this.people.set(next);
      }

      const allRes = trips.flatMap((t) => t.reservations.map((r) => r.id));
      this.paid.set(await this.svc.paidReservationIds(allRes));

      const done = res.filter((r) => r.statut === 'confirmee' && r.trip.statut === 'termine').map((r) => r.trip_id);
      const rv = new Set<string>();
      await Promise.all(done.map(async (id) => { if (await this.rides.hasReviewed('trip', id)) rv.add(id); }));
      this.reviewed.set(rv);
    } catch (e) { console.warn('chargement mes trajets', e); }
  }

  private async act(id: string, fn: () => Promise<unknown>, ok: string) {
    this.busy.set(id);
    try { await fn(); this.toast.ok(ok); await this.load(); }
    catch (e) { this.toast.error(messageErreur(e)); }
    finally { this.busy.set(null); }
  }

  confirm(id: string) { return this.act(id, () => this.svc.confirm(id), 'Réservation confirmée.'); }
  cancelReservation(id: string) { return this.act(id, () => this.svc.cancelReservation(id), 'Réservation annulée.'); }
  finishTrip(id: string) { return this.act(id, () => this.svc.finishTrip(id), 'Trajet terminé : vous pouvez encaisser les passagers.'); }
  cancelTrip(id: string) {
    if (!confirm('Annuler ce trajet ? Toutes les réservations seront annulées.')) return;
    return this.act(id, () => this.svc.cancelTrip(id), 'Trajet annulé.');
  }

  async collect(reservationId: string, montant: number) {
    const moyen = this.moyenChoisi.get(reservationId) ?? 'especes';
    this.busy.set(reservationId);
    try {
      await this.svc.collect(reservationId, moyen);
      this.toast.ok(moyen === 'especes'
        ? `${fcfa(montant)} encaissés en espèces. Commission de ${fcfa(montant * 0.05)} à régler à Yobbalema.`
        : `${fcfa(montant)} encaissés via ${LIBELLES_MOYEN[moyen]}.`);
      await this.load();
    } catch (e) { this.toast.error(messageErreur(e)); }
    finally { this.busy.set(null); }
  }

  async rate(tripId: string) {
    this.busy.set(tripId);
    try { await this.rides.rate('trip', tripId, this.notes()[tripId] || 5, null); this.toast.ok('Merci pour votre avis !'); await this.load(); }
    catch (e) { this.toast.error(messageErreur(e)); }
    finally { this.busy.set(null); }
  }
}
