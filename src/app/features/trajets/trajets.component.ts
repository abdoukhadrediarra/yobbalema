import { DatePipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PublicProfile, Trip, Vehicle } from '../../core/models/models';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../core/services/toast.service';
import { TripsService } from '../../core/services/trips.service';
import { LIBELLES_CATEGORIE, fcfa, messageErreur } from '../../core/util/format';
import { StarsComponent } from '../../shared/stars/stars.component';

@Component({
  selector: 'app-trajets',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe, StarsComponent],
  template: `
<section class="page">
  <div class="container">
    <header class="page-head">
      <div>
        <h1>Trajets interurbains</h1>
        <p>Trouvez une place dans un trajet entre deux villes, réservée à l'avance.</p>
      </div>
      <div class="row">
        <a routerLink="/mes-trajets" class="btn btn--outline"><i class="bi bi-ticket-perforated"></i> Mes réservations</a>
        @if (estChauffeur) { <a routerLink="/trajets/publier" class="btn btn--gold"><i class="bi bi-plus-lg"></i> Publier un trajet</a> }
      </div>
    </header>

    <form class="card row" style="align-items:flex-end" (ngSubmit)="search()">
      <div class="field" style="flex:1;min-width:160px"><label for="dep">Départ</label><input id="dep" name="dep" [ngModel]="depart()" (ngModelChange)="depart.set($event)" placeholder="Dakar"></div>
      <div class="field" style="flex:1;min-width:160px"><label for="arr">Arrivée</label><input id="arr" name="arr" [ngModel]="arrivee()" (ngModelChange)="arrivee.set($event)" placeholder="Saint-Louis"></div>
      <div class="field"><label for="dat">Date</label><input id="dat" name="dat" type="date" [ngModel]="date()" (ngModelChange)="date.set($event)"></div>
      <button class="btn btn--ink" type="submit" [disabled]="loading()"><i class="bi bi-search"></i> Rechercher</button>
    </form>

    <div class="stack mt-2">
      @if (loading()) {
        <div class="empty"><span class="pulse-dot"></span></div>
      } @else {
        @for (t of trips(); track t.id) {
          <article class="card">
            <div class="row row--between" style="align-items:flex-start;gap:1.5rem">
              <div class="stack" style="--gap:.5rem;flex:1;min-width:240px">
                <div style="font-family:var(--font-display);font-size:1.4rem;color:var(--color-ink);font-weight:600">
                  {{ t.depart_label }} <i class="bi bi-arrow-right" style="color:var(--color-gold-deep)"></i> {{ t.arrivee_label }}
                </div>
                <div class="strong"><i class="bi bi-calendar-event"></i> {{ t.date_heure_depart | date: "EEEE d MMMM 'à' HH'h'mm" }}</div>
                <div class="small muted row" style="gap:.6rem">
                  <span><i class="bi bi-person-circle"></i> {{ drivers().get(t.driver_id)?.prenom || 'Chauffeur' }}</span>
                  @if (drivers().get(t.driver_id)?.note_moyenne; as n) { <app-stars [value]="n" [readonly]="true" /> }
                  @if (vehicles().get(t.vehicle_id); as v) { <span><i class="bi bi-car-front"></i> {{ v.marque }} {{ v.modele }} · {{ cat(v.categorie) }}</span> }
                </div>
              </div>
              <div class="stack" style="--gap:.6rem;align-items:flex-end;min-width:200px">
                <div class="price">{{ fcfa(t.prix_place) }} <small>/ place</small></div>
                <span class="tag" [class]="t.places_dispo <= 1 ? 'tag tag--wait' : 'tag tag--ok'">{{ t.places_dispo }} place{{ t.places_dispo > 1 ? 's' : '' }} restante{{ t.places_dispo > 1 ? 's' : '' }}</span>
                <div class="row">
                  <select class="btn--sm" style="padding:.5em .7em;border-radius:8px;border:1.5px solid var(--color-paper-line)" [attr.aria-label]="'Nombre de places'" (change)="setPlaces(t.id, +$any($event.target).value)">
                    @for (n of range(t.places_dispo); track n) { <option [value]="n">{{ n }} place{{ n > 1 ? 's' : '' }}</option> }
                  </select>
                  <button class="btn btn--gold btn--sm" (click)="reserve(t)" [disabled]="busy() === t.id">
                    @if (busy() === t.id) { … } @else { Réserver · {{ fcfa(t.prix_place * places(t.id)) }} }
                  </button>
                </div>
              </div>
            </div>
          </article>
        } @empty {
          <div class="card empty"><i class="bi bi-signpost-split"></i><p><strong>Aucun trajet trouvé.</strong><br>Modifiez vos critères, ou revenez plus tard : de nouveaux trajets sont publiés chaque jour.</p></div>
        }
      }
    </div>
    <p class="xs muted mt-2">Votre réservation est envoyée au chauffeur, qui la confirme. Le paiement se fait à la fin du trajet (espèces, Wave ou Orange Money).</p>
  </div>
</section>
  `,
})
export class TrajetsComponent implements OnInit {
  readonly fcfa = fcfa;
  readonly loading = signal(true);
  readonly busy = signal<string | null>(null);
  readonly trips = signal<Trip[]>([]);
  readonly drivers = signal<Map<string, PublicProfile>>(new Map());
  readonly vehicles = signal<Map<string, Vehicle>>(new Map());
  readonly depart = signal('');
  readonly arrivee = signal('');
  readonly date = signal('');
  private nb = new Map<string, number>();
  estChauffeur = false;

  constructor(private svc: TripsService, private toast: ToastService, sb: SupabaseService) {
    this.estChauffeur = sb.currentProfile()?.role === 'chauffeur';
  }

  ngOnInit() { this.search(); }

  cat(c: string) { return LIBELLES_CATEGORIE[c] ?? c; }
  range(max: number) { return Array.from({ length: Math.min(max, 6) }, (_, i) => i + 1); }
  places(id: string) { return this.nb.get(id) ?? 1; }
  setPlaces(id: string, n: number) { this.nb.set(id, n); this.trips.update((t) => [...t]); }

  async search() {
    this.loading.set(true);
    try {
      const trips = await this.svc.search({ depart: this.depart(), arrivee: this.arrivee(), date: this.date() });
      const [drivers, vehicles] = await Promise.all([
        this.svc.profiles(trips.map((t) => t.driver_id)), this.svc.vehicles(trips.map((t) => t.vehicle_id)),
      ]);
      this.trips.set(trips); this.drivers.set(drivers); this.vehicles.set(vehicles);
    } catch (e) { this.toast.error(messageErreur(e)); }
    finally { this.loading.set(false); }
  }

  async reserve(t: Trip) {
    this.busy.set(t.id);
    try {
      await this.svc.reserve(t.id, this.places(t.id));
      this.toast.ok('Demande envoyée ! Le chauffeur doit la confirmer — suivez-la dans « Mes réservations ».');
      await this.search();
    } catch (e) { this.toast.error(messageErreur(e)); }
    finally { this.busy.set(null); }
  }
}
