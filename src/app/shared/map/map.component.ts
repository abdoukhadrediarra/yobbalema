import {
  AfterViewInit, Component, ElementRef, EventEmitter, Input, NgZone, OnChanges,
  OnDestroy, Output, SimpleChanges, ViewChild,
} from '@angular/core';
import { DAKAR } from '../../core/services/geo.service';
import { GoogleMapsLoader } from '../../core/services/google-maps.loader';
import { GoogleEngine, LeafletEngine, MapEngine } from './engines';

export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  /** Classe Bootstrap Icons, ex. « bi-geo-alt-fill ». */
  icon: string;
  color?: string;
  label?: string;
  draggable?: boolean;
  /** 'pin' (goutte) ou 'round' (pastille) */
  shape?: 'pin' | 'round';
}

export interface MapRoute {
  points: [number, number][];
  color?: string;
  dashed?: boolean;
}

/**
 * Carte : Google Maps si une clé est configurée (environment.googleMapsApiKey),
 * sinon OpenStreetMap (Leaflet). Si Google échoue au chargement, repli sur OpenStreetMap.
 * `fitKey` : la carte ne se recadre que lorsque cette valeur change, pour ne pas
 * arracher la vue à l'utilisateur à chaque rafraîchissement des données.
 */
@Component({
  selector: 'app-map',
  standalone: true,
  template: `<div #host class="map-host"></div>`,
  styles: [`:host { display: block; height: 100%; } .map-host { height: 100%; width: 100%; min-height: 240px; }`],
})
export class MapComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('host', { static: true }) host!: ElementRef<HTMLDivElement>;

  @Input() center: [number, number] = DAKAR;
  @Input() zoom = 12;
  @Input() markers: MapMarker[] = [];
  @Input() routes: MapRoute[] = [];
  @Input() clickable = false;
  @Input() fitKey: string | number = '';

  @Output() mapClick = new EventEmitter<{ lat: number; lng: number }>();
  @Output() markerMoved = new EventEmitter<{ id: string; lat: number; lng: number }>();

  private engine?: MapEngine;
  private destroyed = false;
  private lastFit: string | number | undefined;

  constructor(private zone: NgZone, private gm: GoogleMapsLoader) {}

  async ngAfterViewInit() {
    const cb = {
      onClick: (p: { lat: number; lng: number }) => this.zone.run(() => this.mapClick.emit(p)),
      onMarkerMoved: (p: { id: string; lat: number; lng: number }) => this.zone.run(() => this.markerMoved.emit(p)),
    };
    const clickable = () => this.clickable;
    const el = this.host.nativeElement;

    let engine: MapEngine | undefined;
    if (this.gm.disponible()) {
      try {
        await this.gm.load();
        engine = await this.zone.runOutsideAngular(() => GoogleEngine.create(el, this.center, this.zoom, cb, clickable));
      } catch (e) {
        console.warn('[Carte] Google Maps indisponible, repli sur OpenStreetMap', e);
        el.innerHTML = '';
      }
    }
    if (!engine) engine = this.zone.runOutsideAngular(() => new LeafletEngine(el, this.center, this.zoom, cb, clickable));
    if (this.destroyed) { engine.destroy(); return; }

    this.engine = engine;
    this.engine.setClickable(this.clickable);
    this.render(true);
  }

  ngOnChanges(ch: SimpleChanges) {
    if (!this.engine) return;
    this.render(false);
    if (ch['center'] && !ch['center'].firstChange && !this.hasContent()) {
      this.zone.runOutsideAngular(() => this.engine!.setView(this.center, this.zoom));
    }
    this.engine.setClickable(this.clickable);
  }

  ngOnDestroy() {
    this.destroyed = true;
    this.engine?.destroy();
  }

  private hasContent() {
    return this.markers.length > 0 || this.routes.some((r) => r.points.length > 1);
  }

  private render(first: boolean) {
    const fit = first || this.fitKey !== this.lastFit;
    this.lastFit = this.fitKey;
    this.zone.runOutsideAngular(() => this.engine?.render(this.markers, this.routes, fit, this.center, this.zoom));
  }
}
