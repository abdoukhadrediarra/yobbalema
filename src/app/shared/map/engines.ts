import * as L from 'leaflet';
import type { MapMarker, MapRoute } from './map.component';

export interface EngineCallbacks {
  onClick: (p: { lat: number; lng: number }) => void;
  onMarkerMoved: (p: { id: string; lat: number; lng: number }) => void;
}

/** Interface commune aux deux fournisseurs de carte (Google Maps, OpenStreetMap/Leaflet). */
export interface MapEngine {
  render(markers: MapMarker[], routes: MapRoute[], fit: boolean, center: [number, number], zoom: number): void;
  setView(center: [number, number], zoom: number): void;
  setClickable(on: boolean): void;
  destroy(): void;
}

/** HTML d'un marqueur (pastille ou goutte) avec une icône Bootstrap Icons. */
export function markerHtml(m: MapMarker): { html: string; pin: boolean } {
  const pin = (m.shape ?? 'pin') === 'pin';
  const color = m.color ?? '#17233B';
  const cls = pin ? 'ymarker__pin' : 'ymarker__round';
  return { html: `<span class="${cls}" style="background:${color}"><i class="bi ${m.icon}"></i></span>`, pin };
}

// ======================================================================= Leaflet
export class LeafletEngine implements MapEngine {
  private map: L.Map;
  private markerLayer = L.layerGroup();
  private routeLayer = L.layerGroup();

  constructor(private host: HTMLElement, center: [number, number], zoom: number, private cb: EngineCallbacks, private clickable: () => boolean) {
    this.map = L.map(host, { zoomControl: true, attributionControl: true }).setView(center, zoom);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(this.map);
    this.routeLayer.addTo(this.map);
    this.markerLayer.addTo(this.map);
    this.map.on('click', (e: L.LeafletMouseEvent) => {
      if (this.clickable()) this.cb.onClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
    setTimeout(() => this.map.invalidateSize(), 0);
    setTimeout(() => this.map.invalidateSize(), 300);
  }

  render(markers: MapMarker[], routes: MapRoute[], fit: boolean, _c: [number, number], zoom: number) {
    this.markerLayer.clearLayers();
    this.routeLayer.clearLayers();
    for (const r of routes) {
      if (r.points.length < 2) continue;
      L.polyline(r.points, { color: r.color ?? '#17233B', weight: 5, opacity: 0.85, dashArray: r.dashed ? '8 8' : undefined }).addTo(this.routeLayer);
    }
    for (const m of markers) {
      const { html, pin } = markerHtml(m);
      const size = pin ? 34 : 32;
      const icon = L.divIcon({
        className: 'ymarker', html, iconSize: [size, size],
        iconAnchor: pin ? [size / 2, size] : [size / 2, size / 2],
        tooltipAnchor: [0, pin ? -size : -size / 2],
      });
      const marker = L.marker([m.lat, m.lng], { icon, draggable: !!m.draggable, keyboard: false });
      if (m.label) marker.bindTooltip(m.label, { direction: 'top', className: 'ytip' });
      if (m.draggable) {
        marker.on('dragend', () => {
          const p = marker.getLatLng();
          this.cb.onMarkerMoved({ id: m.id, lat: p.lat, lng: p.lng });
        });
      }
      marker.addTo(this.markerLayer);
    }
    if (fit) {
      const pts: L.LatLngExpression[] = [...markers.map((m) => [m.lat, m.lng] as [number, number]), ...routes.flatMap((r) => r.points)];
      if (pts.length >= 2) this.map.fitBounds(L.latLngBounds(pts), { padding: [40, 40], maxZoom: 16 });
      else if (pts.length === 1) this.map.setView(pts[0], Math.max(zoom, 14));
    }
  }

  setView(center: [number, number], zoom: number) { this.map.setView(center, zoom); }
  setClickable(on: boolean) { this.host.style.cursor = on ? 'crosshair' : ''; }
  destroy() { this.map.remove(); }
}

// ================================================================= Google Maps
export class GoogleEngine implements MapEngine {
  private markers: google.maps.marker.AdvancedMarkerElement[] = [];
  private lines: google.maps.Polyline[] = [];

  private constructor(
    private map: google.maps.Map,
    private lib: google.maps.MarkerLibrary,
    private cb: EngineCallbacks,
    private clickable: () => boolean,
  ) {
    this.map.addListener('click', (e: google.maps.MapMouseEvent) => {
      if (this.clickable() && e.latLng) this.cb.onClick({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    });
  }

  static async create(host: HTMLElement, center: [number, number], zoom: number, cb: EngineCallbacks, clickable: () => boolean): Promise<GoogleEngine> {
    const { Map } = (await google.maps.importLibrary('maps')) as google.maps.MapsLibrary;
    const lib = (await google.maps.importLibrary('marker')) as google.maps.MarkerLibrary;
    const map = new Map(host, {
      center: { lat: center[0], lng: center[1] }, zoom,
      mapId: 'DEMO_MAP_ID', // identifiant de démonstration fourni par Google (requis pour les marqueurs avancés)
      gestureHandling: 'greedy', clickableIcons: false,
      streetViewControl: false, mapTypeControl: false, fullscreenControl: false,
    });
    return new GoogleEngine(map, lib, cb, clickable);
  }

  render(markers: MapMarker[], routes: MapRoute[], fit: boolean, _c: [number, number], zoom: number) {
    this.markers.forEach((m) => (m.map = null));
    this.lines.forEach((l) => l.setMap(null));
    this.markers = []; this.lines = [];

    for (const r of routes) {
      if (r.points.length < 2) continue;
      const path = r.points.map(([lat, lng]) => ({ lat, lng }));
      this.lines.push(new google.maps.Polyline({
        map: this.map, path, strokeColor: r.color ?? '#17233B', strokeWeight: 5,
        strokeOpacity: r.dashed ? 0 : 0.85,
        icons: r.dashed ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.85, scale: 3 }, offset: '0', repeat: '14px' }] : undefined,
      }));
    }

    for (const m of markers) {
      const { html, pin } = markerHtml(m);
      const el = document.createElement('div');
      el.className = 'ymarker';
      el.innerHTML = html;
      // AdvancedMarker ancre le bas-centre : correct pour la goutte, à recentrer pour la pastille.
      if (!pin) el.style.transform = 'translateY(50%)';
      const marker = new this.lib.AdvancedMarkerElement({
        map: this.map, position: { lat: m.lat, lng: m.lng }, content: el,
        title: m.label, gmpDraggable: !!m.draggable,
      });
      if (m.draggable) {
        marker.addListener('dragend', () => {
          const p = marker.position as google.maps.LatLng | google.maps.LatLngLiteral | null | undefined;
          if (!p) return;
          const lat = typeof (p as google.maps.LatLng).lat === 'function' ? (p as google.maps.LatLng).lat() : (p as google.maps.LatLngLiteral).lat;
          const lng = typeof (p as google.maps.LatLng).lng === 'function' ? (p as google.maps.LatLng).lng() : (p as google.maps.LatLngLiteral).lng;
          this.cb.onMarkerMoved({ id: m.id, lat, lng });
        });
      }
      this.markers.push(marker);
    }

    if (fit) {
      const pts = [...markers.map((m) => ({ lat: m.lat, lng: m.lng })), ...routes.flatMap((r) => r.points.map(([lat, lng]) => ({ lat, lng })))];
      if (pts.length >= 2) {
        const b = new google.maps.LatLngBounds();
        pts.forEach((p) => b.extend(p));
        this.map.fitBounds(b, 40);
        google.maps.event.addListenerOnce(this.map, 'idle', () => {
          if ((this.map.getZoom() ?? 0) > 16) this.map.setZoom(16);
        });
      } else if (pts.length === 1) {
        this.map.setCenter(pts[0]);
        this.map.setZoom(Math.max(zoom, 14));
      }
    }
  }

  setView(center: [number, number], zoom: number) {
    this.map.setCenter({ lat: center[0], lng: center[1] });
    this.map.setZoom(zoom);
  }
  setClickable(on: boolean) { this.map.setOptions({ draggableCursor: on ? 'crosshair' : undefined }); }
  destroy() {
    this.markers.forEach((m) => (m.map = null));
    this.lines.forEach((l) => l.setMap(null));
    google.maps.event.clearInstanceListeners(this.map);
  }
}
