import { DatePipe } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CategorieVehicule, DriverPricing, DriverStatus, Payment, PricingConfig, Solde, Vehicle } from '../../core/models/models';
import { DriverService, TarifMoyen } from '../../core/services/driver.service';
import { Fournisseur, PaymentsConfig, PaymentsService } from '../../core/services/payments.service';
import { RidesService } from '../../core/services/rides.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../core/services/toast.service';
import { LIBELLES_CATEGORIE, LIBELLES_MOYEN, fcfa, messageErreur } from '../../core/util/format';

const TOUTES: CategorieVehicule[] = ['standard', 'confort', 'pro', 'moto', 'jakarta', 'tiak_tiak'];
const COURSES: CategorieVehicule[] = ['standard', 'confort', 'pro'];

@Component({
  selector: 'app-chauffeur-compte',
  standalone: true,
  imports: [FormsModule, RouterLink, DatePipe],
  template: `
<section class="page">
  <div class="container">
    <header class="page-head">
      <div>
        <h1>Espace chauffeur</h1>
        <p>Vos véhicules, vos tarifs et vos revenus.</p>
      </div>
      <a routerLink="/chauffeur/missions" class="btn btn--gold"><i class="bi bi-lightning-charge-fill"></i> Passer en ligne</a>
    </header>

    @if (!estChauffeur()) {
      <div class="alert alert--warn"><i class="bi bi-lock"></i><p>Cet espace est réservé aux comptes <strong>chauffeur</strong>.</p></div>
    } @else {
      <div class="stack stack--lg">

        @if (status(); as s) {
          <div class="cols-3">
            <div class="card">
              <span class="xs muted">Vérification d'identité</span>
              <div class="mt-1"><span class="tag" [class]="s.statut_verif === 'verifie' ? 'tag tag--ok' : s.statut_verif === 'rejete' ? 'tag tag--bad' : 'tag tag--wait'">
                {{ s.statut_verif === 'verifie' ? 'Vérifié' : s.statut_verif === 'rejete' ? 'Refusé' : 'En attente' }}</span></div>
              @if (s.statut_verif !== 'verifie') { <p class="xs muted mt-1 mb-0"><a routerLink="/profil" class="strong">Ajouter mes documents</a></p> }
            </div>
            <div class="card">
              <span class="xs muted">Commission à régler</span>
              <div class="price" [style.color]="s.bloque ? 'var(--color-rust-deep)' : ''">{{ fcfa(s.dette_total) }}</div>
              @if (s.bloque) {
                <p class="xs mt-1 mb-0" style="color:var(--color-rust-deep)">Compte bloqué jusqu'au règlement.</p>
                @if (s.mode_test_paiements) { <button class="btn btn--ink btn--sm mt-1" (click)="settle(s)" [disabled]="busy()">Régler (simulation)</button> }
                @else {
                  @if (cfg(); as c) {
                    <div class="row mt-1">
                      @if (c.fournisseurs.includes('wave')) { <button class="btn btn--teal btn--sm" (click)="payDebt('wave')" [disabled]="busy()">Payer avec Wave</button> }
                      @if (c.fournisseurs.includes('orange_money')) { <button class="btn btn--gold btn--sm" (click)="payDebt('orange_money')" [disabled]="busy()">Payer avec Orange Money</button> }
                    </div>
                  }
                }
              } @else { <p class="xs muted mt-1 mb-0">Aucune dette : vous pouvez accepter des missions.</p> }
            </div>
            <div class="card">
              <span class="xs muted">Revenus enregistrés (net de commission)</span>
              <div class="price">{{ fcfa(netTotal()) }}</div>
              <p class="xs muted mt-1 mb-0">{{ earnings().length }} paiement(s)</p>
            </div>
          </div>
        }

        @if (solde(); as so) {
          <div class="card row row--between" style="align-items:flex-start">
            <div>
              <span class="xs muted">À recevoir de Yobbalema (paiements en ligne, net de commission)</span>
              <div class="price">{{ fcfa(so.a_verser) }}</div>
              <span class="xs muted">Versé jusqu'ici : {{ fcfa(so.deja_verse) }}
                @if (so.dettes_deduites > 0) { · dettes déduites automatiquement : {{ fcfa(so.dettes_deduites) }} }
                @if (so.en_attente_de_paiement > 0) { · en attente de paiement client : {{ fcfa(so.en_attente_de_paiement) }} }</span>
            </div>
            <p class="xs muted mb-0" style="max-width:340px">Les paiements en espèces vous restent directement. Les paiements Wave / Orange Money sont encaissés par Yobbalema, qui vous les reverse (5 % de commission déjà retirés). Une commission impayée est déduite automatiquement.</p>
          </div>
        }

        <div class="cols-2">
          <div class="card stack">
            <h2>Mes véhicules</h2>
            @for (v of vehicles(); track v.id) {
              <div class="list-item">
                <div>
                  <strong>{{ cat(v.categorie) }}</strong> <span class="muted">— {{ v.marque }} {{ v.modele }}</span>
                  <div class="xs muted">{{ v.immatriculation }}</div>
                </div>
                <button class="btn btn--danger btn--sm" (click)="removeVehicle(v)">Retirer</button>
              </div>
            } @empty { <p class="muted small mb-0">Aucun véhicule. Ajoutez-en un pour recevoir des demandes.</p> }

            <form class="stack" style="border-top:1px solid var(--color-paper-line);padding-top:1rem" (ngSubmit)="addVehicle()">
              <strong class="small">Ajouter un véhicule</strong>
              <div class="field">
                <label for="vcat">Type</label>
                <select id="vcat" name="vcat" [ngModel]="newCat()" (ngModelChange)="newCat.set($event)">
                  @for (c of toutes; track c) { <option [value]="c">{{ cat(c) }}</option> }
                </select>
              </div>
              <div class="row" style="align-items:flex-end">
                <div class="field" style="flex:1"><label for="vmarque">Marque</label><input id="vmarque" name="vmarque" [ngModel]="marque()" (ngModelChange)="marque.set($event)" placeholder="Toyota"></div>
                <div class="field" style="flex:1"><label for="vmodele">Modèle</label><input id="vmodele" name="vmodele" [ngModel]="modele()" (ngModelChange)="modele.set($event)" placeholder="Corolla"></div>
              </div>
              <div class="field"><label for="vimmat">Immatriculation</label><input id="vimmat" name="vimmat" [ngModel]="immat()" (ngModelChange)="immat.set($event)" placeholder="DK-1234-AB"></div>
              <button class="btn btn--ink" type="submit" [disabled]="busy()">Ajouter</button>
            </form>
          </div>

          <div class="card stack">
            <h2>Mes tarifs au kilomètre</h2>
            <p class="small muted mb-0">Vous fixez votre prix dans la fourchette autorisée. Le client voit le tarif de base ; vous voyez ici votre tarif et la moyenne des autres chauffeurs.</p>
            @for (p of tarifsCourses(); track p.categorie) {
              <div class="stack" style="--gap:.4rem;border-top:1px solid var(--color-paper-line);padding-top:1rem">
                <div class="row row--between">
                  <strong>{{ cat(p.categorie) }}</strong>
                  <span class="price">{{ tarifEdit()[p.categorie] }} <small>FCFA/km</small></span>
                </div>
                <div class="field">
                  <input type="range" [min]="p.tarif_km_min" [max]="p.tarif_km_max" step="5" [value]="tarifEdit()[p.categorie]" (input)="setTarif(p.categorie, +$any($event.target).value)" [attr.aria-label]="'Tarif ' + cat(p.categorie)">
                </div>
                <div class="row row--between xs muted">
                  <span>min {{ p.tarif_km_min }}</span>
                  <span>base {{ p.tarif_km_base }} · moyenne {{ moyenne(p.categorie) }}</span>
                  <span>max {{ p.tarif_km_max }}</span>
                </div>
                <div><button class="btn btn--outline btn--sm" (click)="saveTarif(p.categorie)" [disabled]="busy()">Enregistrer ce tarif</button></div>
              </div>
            }
          </div>
        </div>

        <div class="card">
          <h2>Derniers paiements reçus</h2>
          @for (p of earnings(); track p.id) {
            <div class="list-item">
              <div>
                <strong>{{ fcfa(p.montant) }}</strong> <span class="tag tag--off">{{ moyen(p.moyen) }}</span>
                <div class="xs muted">{{ p.created_at | date: 'd MMM y, HH:mm' }} · {{ p.categorie_montant }}</div>
              </div>
              <div class="small" style="text-align:right">Commission {{ p.commission_pct }} % : {{ fcfa(p.montant * p.commission_pct / 100) }}<br>
                <strong>Net : {{ fcfa(p.montant * (100 - p.commission_pct) / 100) }}</strong></div>
            </div>
          } @empty { <p class="muted small mb-0">Aucun paiement pour le moment.</p> }
        </div>
      </div>
    }
  </div>
</section>
  `,
})
export class ChauffeurCompteComponent implements OnInit {
  readonly fcfa = fcfa;
  readonly toutes = TOUTES;
  readonly busy = signal(false);
  readonly status = signal<DriverStatus | null>(null);
  readonly vehicles = signal<Vehicle[]>([]);
  readonly pricing = signal<PricingConfig[]>([]);
  readonly mine = signal<DriverPricing[]>([]);
  readonly avg = signal<TarifMoyen[]>([]);
  readonly earnings = signal<Payment[]>([]);
  readonly tarifEdit = signal<Record<string, number>>({});
  readonly solde = signal<Solde | null>(null);
  readonly cfg = signal<PaymentsConfig | null>(null);

  readonly newCat = signal<CategorieVehicule>('standard');
  readonly marque = signal('');
  readonly modele = signal('');
  readonly immat = signal('');

  readonly estChauffeur = computed(() => this.sb.currentProfile()?.role === 'chauffeur');
  readonly tarifsCourses = computed(() => this.pricing().filter((p) => COURSES.includes(p.categorie)));
  readonly netTotal = computed(() => this.earnings().reduce((s, p) => s + p.montant * (1 - p.commission_pct / 100), 0));

  constructor(
    private driver: DriverService, private rides: RidesService, private sb: SupabaseService, private toast: ToastService, private payments: PaymentsService,
  ) {}

  async ngOnInit() {
    if (!this.estChauffeur()) return;
    try {
      const [status, vehicles, pricing, mine, avg, earnings] = await Promise.all([
        this.driver.status(), this.driver.vehicles(), this.rides.pricing(), this.driver.myPricing(), this.driver.averages(), this.driver.earnings(),
      ]);
      this.solde.set(await this.payments.solde().catch(() => null)); this.cfg.set(await this.payments.config().catch(() => null));
      this.status.set(status); this.vehicles.set(vehicles); this.pricing.set(pricing); this.mine.set(mine); this.avg.set(avg); this.earnings.set(earnings);
      const edit: Record<string, number> = {};
      for (const p of pricing) edit[p.categorie] = Number(mine.find((m) => m.categorie === p.categorie)?.tarif_km_choisi ?? p.tarif_km_base);
      this.tarifEdit.set(edit);
    } catch (e) { this.toast.error(messageErreur(e)); }
  }

  cat(c: string) { return LIBELLES_CATEGORIE[c] ?? c; }
  moyen(m: string) { return LIBELLES_MOYEN[m] ?? m; }
  moyenne(c: CategorieVehicule) {
    const a = this.avg().find((x) => x.categorie === c);
    return a ? Math.round(Number(a.tarif_moyen)) : '—';
  }
  setTarif(c: CategorieVehicule, v: number) { this.tarifEdit.update((t) => ({ ...t, [c]: v })); }

  async saveTarif(c: CategorieVehicule) {
    this.busy.set(true);
    try {
      await this.driver.savePricing(c, this.tarifEdit()[c]);
      this.avg.set(await this.driver.averages());
      this.toast.ok(`Tarif ${this.cat(c)} enregistré : ${this.tarifEdit()[c]} FCFA/km.`);
    } catch (e) { this.toast.error(messageErreur(e)); } finally { this.busy.set(false); }
  }

  async addVehicle() {
    this.busy.set(true);
    try {
      await this.driver.addVehicle({
        categorie: this.newCat(), marque: this.marque().trim() || null, modele: this.modele().trim() || null,
        immatriculation: this.immat().trim().toUpperCase() || null,
      });
      this.vehicles.set(await this.driver.vehicles());
      this.marque.set(''); this.modele.set(''); this.immat.set('');
      this.toast.ok('Véhicule ajouté.');
    } catch (e) { this.toast.error(messageErreur(e)); } finally { this.busy.set(false); }
  }

  async removeVehicle(v: Vehicle) {
    if (!confirm(`Retirer ce véhicule (${this.cat(v.categorie)}) ?`)) return;
    try { await this.driver.deleteVehicle(v.id); this.vehicles.set(await this.driver.vehicles()); this.toast.info('Véhicule retiré.'); }
    catch (e) { this.toast.error(messageErreur(e, "Impossible de retirer ce véhicule (il est peut-être lié à un trajet).")); }
  }

  async payDebt(provider: Fournisseur) {
    this.busy.set(true);
    try { window.location.href = await this.payments.payDebt(provider); }
    catch (e) { this.toast.error(messageErreur(e)); this.busy.set(false); }
  }

  async settle(s: DriverStatus) {
    this.busy.set(true);
    try {
      for (const d of s.dettes) await this.driver.settleDebt(d.id);
      this.status.set(await this.driver.status());
      this.toast.ok('Dette réglée (simulation).');
    } catch (e) { this.toast.error(messageErreur(e)); } finally { this.busy.set(false); }
  }
}
