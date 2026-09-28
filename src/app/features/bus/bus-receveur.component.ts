import { Component, OnDestroy, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BusLine } from '../../core/models/models';
import { BusService } from '../../core/services/bus.service';
import { GeoService, Place } from '../../core/services/geo.service';
import { SupabaseService } from '../../core/services/supabase.service';
import { ToastService } from '../../core/services/toast.service';
import { ilYA, messageErreur } from '../../core/util/format';
import { MapComponent, MapMarker, MapRoute } from '../../shared/map/map.component';
import { PlaceFieldComponent } from '../../shared/place-field/place-field.component';

@Component({
  selector: 'app-bus-receveur',
  standalone: true,
  imports: [FormsModule, RouterLink, MapComponent, PlaceFieldComponent],
  template: `
<section class="page">
  <div class="container">
    <header class="page-head">
      <div><h1>Espace receveur</h1><p>Créez votre ligne et partagez la position de votre bus : les voyageurs voient son arrivée en direct.</p></div>
      <a routerLink="/bus" class="btn btn--outline"><i class="bi bi-eye"></i> Voir comme un voyageur</a>
    </header>

    @if (!estReceveur()) {
      <div class="alert alert--warn"><i class="bi bi-lock"></i><p>Cet espace est réservé aux comptes <strong>receveur de bus</strong>.</p></div>
    } @else {
      <div class="cols-2 cols-2--form">
        <div class="stack stack--lg">

          <div class="card stack">
            <h2>Partage de position</h2>
            @if (allLines().length === 0) {
              <p class="muted small mb-0">Aucune ligne n'existe encore : créez-la (formulaire ci-dessous).</p>
            } @else {
              <div class="field">
                <label for="ligne">Ligne sur laquelle circule mon bus</label>
                <select id="ligne" [disabled]="sharing()" (change)="selectLine($any($event.target).value)">
                  @for (l of allLines(); track l.id) { <option [value]="l.id" [selected]="l.id === selectedId()">{{ l.nom_ligne }} ({{ l.terminus_depart }} → {{ l.terminus_arrivee }})</option> }
                </select>
              </div>

              <div class="field">
                <label for="blabel">Mon bus (numéro, immatriculation…)</label>
                <input id="blabel" [disabled]="sharing()" [ngModel]="busLabel()" (ngModelChange)="busLabel.set($event)" [ngModelOptions]="{standalone: true}" placeholder="Ex. Bus 2 — DK 4455 AB">
                <span class="field-hint">Plusieurs bus peuvent circuler sur la même ligne : ce libellé les distingue pour les voyageurs.</span>
              </div>

              <div class="choice-grid">
                <div class="choice"><input type="radio" name="mode" id="m-gps" [checked]="mode() === 'gps'" [disabled]="sharing()" (change)="mode.set('gps')">
                  <label for="m-gps"><span class="choice__title"><i class="bi bi-geo-alt"></i> GPS réel</span><span class="choice__sub">Utilise la position de cet appareil (sur le bus)</span></label></div>
                <div class="choice"><input type="radio" name="mode" id="m-sim" [checked]="mode() === 'simulation'" [disabled]="sharing()" (change)="mode.set('simulation')">
                  <label for="m-sim"><span class="choice__title"><i class="bi bi-play-circle"></i> Simulation</span><span class="choice__sub">Le bus roule seul le long du tracé (pour tester)</span></label></div>
              </div>

              @if (mode() === 'simulation') {
                <div class="field">
                  <label for="vit">Vitesse simulée</label>
                  <select id="vit" [disabled]="sharing()" (change)="simSpeed.set(+$any($event.target).value)">
                    @for (v of [20, 40, 80, 150]; track v) { <option [value]="v" [selected]="simSpeed() === v">{{ v }} km/h {{ v >= 80 ? '(accéléré, pour la démo)' : '' }}</option> }
                  </select>
                </div>
                @if (!selected()?.trajet) { <div class="alert alert--warn"><i class="bi bi-exclamation-triangle"></i><p>Cette ligne n'a pas de tracé : la simulation est impossible.</p></div> }
              }

              @if (!sharing()) {
                <button class="btn btn--teal" (click)="start()" [disabled]="!selected() || (mode() === 'simulation' && !selected()?.trajet)"><i class="bi bi-broadcast"></i> Démarrer le partage</button>
              } @else {
                <div class="alert alert--ok"><span class="pulse-dot"></span><p><strong>Position partagée en direct.</strong>
                  @if (lastSent(); as t) { <br><span class="xs">Dernier envoi {{ ago(t) }} · {{ lastSpeed() ?? '—' }} km/h</span> }</p></div>
                <button class="btn btn--danger" (click)="stop()"><i class="bi bi-stop-circle"></i> Arrêter le partage</button>
              }
              @if (shareError()) { <div class="alert alert--error"><i class="bi bi-exclamation-triangle"></i><p>{{ shareError() }}</p></div> }
            }
          </div>

          <div class="card stack">
            <h2>Mes lignes</h2>
            @for (l of lines(); track l.id) {
              <div class="list-item">
                <div><strong>{{ l.nom_ligne }}</strong><div class="xs muted">{{ l.terminus_depart }} → {{ l.terminus_arrivee }} · {{ l.trajet ? l.trajet.length + ' points de tracé' : 'sans tracé' }}</div></div>
                <div class="row">
                  <button class="btn btn--outline btn--sm" (click)="toggleActive(l)" [disabled]="sharing() && l.id === selectedId()">{{ l.actif ? 'Désactiver' : 'Activer' }}</button>
                  <button class="btn btn--danger btn--sm" (click)="remove(l)" [disabled]="sharing() && l.id === selectedId()">Supprimer</button>
                </div>
              </div>
            } @empty { <p class="muted small mb-0">Aucune ligne.</p> }
          </div>

          <form class="card stack" (ngSubmit)="create()">
            <h2>Nouvelle ligne</h2>
            <div class="field"><label for="nom">Nom de la ligne</label><input id="nom" name="nom" [ngModel]="nom()" (ngModelChange)="nom.set($event)" placeholder="Ligne 12" required></div>
            <app-place-field label="Terminus de départ" icon="bi-geo-alt-fill" [place]="tDepart()" (placeChange)="tDepart.set($event)" [gps]="false" />
            <app-place-field label="Terminus d'arrivée" icon="bi-flag-fill" [place]="tArrivee()" (placeChange)="tArrivee.set($event)" [gps]="false" />
            <div class="stack" style="--gap:.5rem">
              <strong class="small">Tracé de la ligne</strong>
              <div class="row">
                <button type="button" class="btn btn--outline btn--sm" (click)="autoTrace()" [disabled]="tracing() || !tDepart() || !tArrivee()"><i class="bi bi-magic"></i> {{ tracing() ? 'Calcul…' : 'Tracer automatiquement' }}</button>
                <button type="button" class="btn btn--outline btn--sm" [class.btn--ink]="drawing()" (click)="drawing.set(!drawing())"><i class="bi bi-pencil"></i> {{ drawing() ? 'Terminer le dessin' : 'Dessiner à la main' }}</button>
                <button type="button" class="btn btn--outline btn--sm" (click)="undoPoint()" [disabled]="!trace().length">Annuler le dernier point</button>
                <button type="button" class="btn btn--danger btn--sm" (click)="trace.set([])" [disabled]="!trace().length">Effacer</button>
              </div>
              <span class="field-hint">{{ trace().length ? trace().length + ' points — le tracé sert à calculer le temps d’arrivée le long de la ligne.' : 'Sans tracé, seule une estimation à vol d’oiseau est possible.' }}</span>
            </div>
            <button class="btn btn--ink" type="submit" [disabled]="busy()">Créer la ligne</button>
          </form>
        </div>

        <div class="stack">
          <div class="map-box map-box--tall">
            <app-map [markers]="markers()" [routes]="routes()" [clickable]="drawing()" [fitKey]="fitKey()" (mapClick)="addPoint($event.lat, $event.lng)" />
          </div>
          @if (drawing()) { <div class="alert alert--warn"><i class="bi bi-pencil"></i><p>Cliquez sur la carte, dans l'ordre du parcours, pour poser les points du tracé.</p></div> }
        </div>
      </div>
    }
  </div>
</section>
  `,
})
export class BusReceveurComponent implements OnInit, OnDestroy {
  readonly busy = signal(false);
  readonly lines = signal<BusLine[]>([]);
  /** Toutes les lignes actives : un receveur peut faire circuler son bus sur une ligne existante. */
  readonly allLines = signal<BusLine[]>([]);
  readonly busLabel = signal('');
  readonly selectedId = signal('');
  readonly mode = signal<'gps' | 'simulation'>('simulation');
  readonly simSpeed = signal(40);
  readonly sharing = signal(false);
  readonly shareError = signal('');
  readonly lastSent = signal<string | null>(null);
  readonly lastSpeed = signal<number | null>(null);
  readonly busPos = signal<{ lat: number; lng: number } | null>(null);
  readonly now = signal(Date.now());
  readonly fitKey = signal(0);

  // formulaire nouvelle ligne
  readonly nom = signal('');
  readonly tDepart = signal<Place | null>(null);
  readonly tArrivee = signal<Place | null>(null);
  readonly trace = signal<[number, number][]>([]);
  readonly drawing = signal(false);
  readonly tracing = signal(false);

  readonly estReceveur = computed(() => this.sb.currentProfile()?.role === 'receveur_bus');
  readonly selected = computed(() => this.allLines().find((l) => l.id === this.selectedId()) ?? null);

  readonly markers = computed<MapMarker[]>(() => {
    const m: MapMarker[] = [];
    const b = this.busPos();
    if (b) m.push({ id: 'bus', lat: b.lat, lng: b.lng, icon: 'bi-bus-front-fill', color: '#F0A93C', shape: 'round', label: 'Votre bus' });
    const d = this.tDepart(); const a = this.tArrivee();
    if (d) m.push({ id: 'd', lat: d.lat, lng: d.lng, icon: 'bi-geo-alt-fill', color: '#0F766E', label: 'Départ' });
    if (a) m.push({ id: 'a', lat: a.lat, lng: a.lng, icon: 'bi-flag-fill', color: '#C1442E', label: 'Arrivée' });
    for (const [i, p] of this.trace().entries()) if (this.drawing()) m.push({ id: 'p' + i, lat: p[0], lng: p[1], icon: 'bi-circle-fill', color: '#17233B', shape: 'round' });
    return m;
  });
  readonly routes = computed<MapRoute[]>(() => {
    const out: MapRoute[] = [];
    if (this.trace().length > 1) out.push({ points: this.trace(), color: '#C1442E', dashed: true });
    const t = this.selected()?.trajet;
    if (t && t.length > 1) out.push({ points: t, color: '#0F766E' });
    return out;
  });

  private timers: ReturnType<typeof setInterval>[] = [];
  private stopGps?: () => void;
  private shareTimer?: ReturnType<typeof setInterval>;
  private gpsLast: { lat: number; lng: number; v: number | null } | null = null;
  private sim = { dist: 0, cum: [] as number[], pts: [] as [number, number][] };

  constructor(private bus: BusService, private geo: GeoService, private sb: SupabaseService, private toast: ToastService) {}

  async ngOnInit() {
    this.timers.push(setInterval(() => this.now.set(Date.now()), 1000));
    if (this.estReceveur()) await this.load();
  }
  ngOnDestroy() { this.timers.forEach(clearInterval); this.stopSharing(); }

  ago(iso: string) { return ilYA(iso, this.now()); }

  async load() {
    try {
      const [l, all] = await Promise.all([this.bus.myLines(), this.bus.activeLines()]);
      this.lines.set(l); this.allLines.set(all);
      if ((!this.selectedId() || !all.some((x) => x.id === this.selectedId())) && all.length) this.selectedId.set(all[0].id);
      this.fitKey.update((k) => k + 1);
    } catch (e) { this.toast.error(messageErreur(e)); }
  }

  selectLine(id: string) { this.selectedId.set(id); this.fitKey.update((k) => k + 1); }

  // ----- création de ligne -----
  addPoint(lat: number, lng: number) { if (this.drawing()) this.trace.update((t) => [...t, [lat, lng]]); }
  undoPoint() { this.trace.update((t) => t.slice(0, -1)); }

  async autoTrace() {
    const d = this.tDepart(); const a = this.tArrivee(); if (!d || !a) return;
    this.tracing.set(true);
    try {
      const r = await this.geo.route(d, a);
      this.trace.set(this.geo.simplify(r.geometry, 120));
      this.fitKey.update((k) => k + 1);
      if (!r.fiable) this.toast.info('Service d\'itinéraire indisponible : tracé en ligne droite. Dessinez-le à la main pour plus de précision.');
    } finally { this.tracing.set(false); }
  }

  async create() {
    if (!this.nom().trim()) { this.toast.error('Donnez un nom à la ligne.'); return; }
    this.busy.set(true);
    try {
      const l = await this.bus.createLine({
        nom_ligne: this.nom().trim(), terminus_depart: this.tDepart()?.label ?? '', terminus_arrivee: this.tArrivee()?.label ?? '',
        trajet: this.trace().length > 1 ? this.trace() : null,
      });
      this.nom.set(''); this.tDepart.set(null); this.tArrivee.set(null); this.trace.set([]); this.drawing.set(false);
      await this.load(); this.selectedId.set(l.id);
      this.toast.ok('Ligne créée.');
    } catch (e) { this.toast.error(messageErreur(e)); } finally { this.busy.set(false); }
  }

  async toggleActive(l: BusLine) {
    try { await this.bus.setActive(l.id, !l.actif); await this.load(); } catch (e) { this.toast.error(messageErreur(e)); }
  }
  async remove(l: BusLine) {
    if (!confirm(`Supprimer la ligne « ${l.nom_ligne} » ?`)) return;
    try { await this.bus.deleteLine(l.id); if (this.selectedId() === l.id) this.selectedId.set(''); await this.load(); this.toast.info('Ligne supprimée.'); }
    catch (e) { this.toast.error(messageErreur(e)); }
  }

  // ----- partage de position -----
  start() {
    const line = this.selected(); if (!line) return;
    this.shareError.set('');
    this.sharing.set(true);
    if (this.mode() === 'gps') {
      this.stopGps = this.geo.watchPosition(
        (p) => { this.gpsLast = { lat: p.lat, lng: p.lng, v: p.vitesseKmh }; this.busPos.set({ lat: p.lat, lng: p.lng }); },
        (msg) => this.shareError.set(msg),
      );
      this.shareTimer = setInterval(() => this.pushGps(line.id), 5000);
      setTimeout(() => this.pushGps(line.id), 1500);
    } else {
      const pts = line.trajet ?? [];
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + this.geo.haversineKm({ lat: pts[i - 1][0], lng: pts[i - 1][1] }, { lat: pts[i][0], lng: pts[i][1] }) * 1000);
      this.sim = { dist: 0, cum, pts };
      this.simStep(line.id);
      this.shareTimer = setInterval(() => this.simStep(line.id), 2000);
    }
  }

  async stop() {
    const id = this.selectedId();
    this.stopSharing();
    try { if (id) await this.bus.stopPosition(id); } catch { /* la position expire seule après 2 minutes */ }
    this.busPos.set(null);
    this.toast.info('Partage arrêté : votre bus n\'est plus affiché.');
  }

  private stopSharing() {
    this.stopGps?.(); this.stopGps = undefined;
    clearInterval(this.shareTimer); this.shareTimer = undefined;
    this.sharing.set(false);
  }

  private async pushGps(lineId: string) {
    const p = this.gpsLast;
    if (!p) return;
    await this.send(lineId, p.lat, p.lng, p.v);
  }

  private async simStep(lineId: string) {
    const { cum, pts } = this.sim;
    const total = cum[cum.length - 1];
    const speed = this.simSpeed();
    if (this.sim.dist >= total) { this.stopSharing(); this.toast.ok('Terminus atteint : partage arrêté.'); return; }
    const [lat, lng] = this.pointAt(this.sim.dist, cum, pts);
    this.sim.dist += (speed / 3.6) * 2;
    await this.send(lineId, lat, lng, speed);
  }

  private pointAt(d: number, cum: number[], pts: [number, number][]): [number, number] {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1] || 1;
    const t = Math.min(1, Math.max(0, (d - cum[i - 1]) / seg));
    return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t];
  }

  private async send(lineId: string, lat: number, lng: number, v: number | null) {
    try {
      await this.bus.sendPosition(lineId, lat, lng, v, this.busLabel().trim() || null);
      this.busPos.set({ lat, lng }); this.lastSent.set(new Date().toISOString()); this.lastSpeed.set(v); this.shareError.set('');
    } catch (e) { this.shareError.set(messageErreur(e)); }
  }
}
