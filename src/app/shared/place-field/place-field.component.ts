import { Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GeoService, Place } from '../../core/services/geo.service';
import { ToastService } from '../../core/services/toast.service';

/**
 * Champ d'adresse : recherche (Nominatim), bouton « ma position », et prise en
 * compte d'un lieu choisi ailleurs (clic sur la carte) via [place].
 */
@Component({
  selector: 'app-place-field',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="pf">
      <label class="pf__label" [attr.for]="inputId">{{ label }}</label>
      <div class="pf__box" [class.pf__box--set]="!!place">
        <i class="bi" [class]="icon"></i>
        <input [id]="inputId" type="text" autocomplete="off" [placeholder]="placeholder"
               [ngModel]="text()" (ngModelChange)="onType($event)"
               (focus)="focus.set(true)" (blur)="onBlur()">
        @if (busy()) { <span class="pf__busy"></span> }
        @if (gps) {
          <button type="button" class="pf__btn" title="Utiliser ma position" aria-label="Utiliser ma position" (click)="useMyPosition()">
            <i class="bi bi-crosshair"></i>
          </button>
        }
        @if (place) {
          <button type="button" class="pf__btn" title="Effacer" aria-label="Effacer" (click)="clear()">
            <i class="bi bi-x-lg"></i>
          </button>
        }
      </div>
      @if (focus() && results().length) {
        <ul class="pf__list" role="listbox">
          @for (r of results(); track r.lat + '' + r.lng) {
            <li role="option" (mousedown)="choose(r)"><i class="bi bi-geo-alt"></i> {{ r.label }}</li>
          }
        </ul>
      }
      @if (mapHint) { <span class="pf__hint"><i class="bi bi-cursor"></i> {{ mapHint }}</span> }
    </div>
  `,
  styles: [`
    .pf { position: relative; display: flex; flex-direction: column; gap: 0.4em; text-align: left; }
    .pf__label { font-size: var(--text-xs); font-weight: 700; color: var(--color-text-soft); }
    .pf__box { display: flex; align-items: center; gap: 0.6em; padding: 0 0.5em 0 0.9em; background: var(--color-white);
      border: 1.5px solid var(--color-paper-line); border-radius: var(--radius-sm); }
    .pf__box:focus-within { border-color: var(--color-gold-deep); }
    .pf__box--set > i { color: var(--color-teal); }
    .pf__box > i { color: var(--color-text-soft); }
    .pf__box input { flex: 1; min-width: 0; border: none; outline: none; background: none; font: inherit; font-size: var(--text-base); padding: 0.75em 0; color: var(--color-text); }
    .pf__btn { background: none; border: none; cursor: pointer; padding: 0.5em; color: var(--color-text-soft); border-radius: 6px; }
    .pf__btn:hover { color: var(--color-ink); background: var(--color-paper-raised); }
    .pf__busy { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--color-paper-line); border-top-color: var(--color-gold-deep); animation: spin 0.7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .pf__list { position: absolute; z-index: 30; top: 100%; left: 0; right: 0; margin: 4px 0 0; padding: 0.3rem; list-style: none;
      background: var(--color-white); border: 1px solid var(--color-paper-line); border-radius: var(--radius-md); box-shadow: var(--shadow-card); max-height: 240px; overflow-y: auto; }
    .pf__list li { padding: 0.65em 0.8em; border-radius: 8px; cursor: pointer; font-size: var(--text-sm); display: flex; gap: 0.6em; align-items: flex-start; }
    .pf__list li i { color: var(--color-rust); margin-top: 0.15em; }
    .pf__list li:hover { background: var(--color-paper-raised); }
    .pf__hint { font-size: var(--text-xs); color: var(--color-text-soft); }
  `],
})
export class PlaceFieldComponent implements OnChanges {
  @Input() label = '';
  @Input() placeholder = 'Rechercher une adresse, un quartier…';
  @Input() icon = 'bi-geo-alt';
  @Input() place: Place | null = null;
  @Input() gps = true;
  @Input() mapHint = '';
  @Input() inputId = 'pf-' + Math.random().toString(36).slice(2, 7);
  @Output() placeChange = new EventEmitter<Place | null>();

  readonly text = signal('');
  readonly results = signal<Place[]>([]);
  readonly busy = signal(false);
  readonly focus = signal(false);
  private timer?: ReturnType<typeof setTimeout>;
  private seq = 0;

  constructor(private geo: GeoService, private toast: ToastService) {}

  ngOnChanges(ch: SimpleChanges) {
    if (ch['place']) this.text.set(this.place?.label ?? '');
  }

  onType(v: string) {
    this.text.set(v);
    if (this.place) { this.place = null; this.placeChange.emit(null); }
    clearTimeout(this.timer);
    if (v.trim().length < 3) { this.results.set([]); return; }
    this.timer = setTimeout(async () => {
      const mine = ++this.seq;
      this.busy.set(true);
      const r = await this.geo.searchPlaces(v);
      if (mine === this.seq) { this.results.set(r); this.busy.set(false); }
    }, 450);
  }

  choose(p: Place) {
    this.results.set([]);
    this.text.set(p.label);
    this.place = p;
    this.placeChange.emit(p);
  }

  clear() {
    this.text.set(''); this.results.set([]); this.place = null; this.placeChange.emit(null);
  }

  onBlur() {
    setTimeout(() => this.focus.set(false), 150);
  }

  async useMyPosition() {
    this.busy.set(true);
    try {
      const pos = await this.geo.currentPosition();
      const label = await this.geo.reverse(pos.lat, pos.lng);
      this.choose({ label, ...pos });
    } catch (e) {
      this.toast.error((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
