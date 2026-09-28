import { Injectable } from '@angular/core';
import { decodePolyline } from '../util/polyline';
import { GoogleMapsLoader } from './google-maps.loader';

export interface Place {
  label: string;
  lat: number;
  lng: number;
}

export interface RouteInfo {
  distanceKm: number;
  durationMin: number;
  /** Points [lat, lng] du tracé routier. */
  geometry: [number, number][];
  /** false si le service d'itinéraire est indisponible (repli sur la ligne droite × 1,3). */
  fiable: boolean;
}

/** Centre de Dakar : position par défaut des cartes. */
export const DAKAR: [number, number] = [14.6937, -17.4441];

/**
 * Géolocalisation, recherche d'adresses et itinéraires.
 *
 * Fournisseur : Google Maps si `googleMapsApiKey` est renseignée dans
 * environment.ts (voir GOOGLE_MAPS.md), sinon OpenStreetMap. Si un appel Google
 * échoue (quota de la clé démo atteint, clé refusée, hors ligne), le service
 * retombe automatiquement sur OpenStreetMap :
 *  - Nominatim : ~1 requête/s, usage modéré
 *  - OSRM (serveur de démonstration) : sans garantie de disponibilité
 * Ces deux services gratuits ne conviennent pas à la production.
 */
@Injectable({ providedIn: 'root' })
export class GeoService {
  constructor(private gm: GoogleMapsLoader) {}

  get provider(): 'google' | 'osm' {
    return this.gm.disponible() ? 'google' : 'osm';
  }

  // ---------------------------------------------------------------- Google
  private async gLib<T>(name: string): Promise<T> {
    await this.gm.load();
    return (await google.maps.importLibrary(name)) as T;
  }

  private async googleSearch(q: string): Promise<Place[]> {
    const { Place: GPlace } = await this.gLib<google.maps.PlacesLibrary>('places');
    const { places } = await GPlace.searchByText({
      textQuery: q,
      fields: ['displayName', 'formattedAddress', 'location'],
      language: 'fr',
      region: 'sn',
      maxResultCount: 6,
      // Biais (et non restriction) vers le Sénégal : on trouve d'abord les lieux du pays.
      locationBias: { west: -17.6, south: 12.2, east: -11.3, north: 16.7 },
    });
    return places
      .filter((p) => !!p.location)
      .map((p) => {
        const name = p.displayName ?? '';
        const addr = (p.formattedAddress ?? '').replace(/,\s*Sénégal$/i, '');
        const label = !addr ? name : !name || addr.toLowerCase().startsWith(name.toLowerCase()) ? addr : `${name}, ${addr}`;
        return { label, lat: p.location!.lat(), lng: p.location!.lng() };
      });
  }

  private async googleReverse(lat: number, lng: number): Promise<string> {
    const { Geocoder } = await this.gLib<google.maps.GeocodingLibrary>('geocoding');
    const { results } = await new Geocoder().geocode({ location: { lat, lng }, language: 'fr' });
    const r = results.find((x) => !x.types.includes('plus_code')) ?? results[0];
    if (!r) throw new Error('aucun résultat');
    const get = (...types: string[]) => r.address_components.find((c) => types.some((t) => c.types.includes(t)))?.long_name;
    const parts = [get('route'), get('sublocality', 'neighborhood', 'sublocality_level_1'), get('locality')].filter((x): x is string => !!x);
    const short = [...new Set(parts)].join(', ');
    return short || r.formatted_address.replace(/,\s*Sénégal$/i, '');
  }

  private async googleRoute(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<RouteInfo> {
    const res = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': this.gm.key,
        'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
        destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
        travelMode: 'DRIVE',
        routingPreference: 'TRAFFIC_UNAWARE',
        languageCode: 'fr',
        units: 'METRIC',
      }),
    });
    if (!res.ok) throw new Error('Routes API ' + res.status);
    const r = (await res.json()).routes?.[0];
    if (!r?.polyline?.encodedPolyline) throw new Error('aucun itinéraire');
    return {
      distanceKm: Math.round((r.distanceMeters / 1000) * 100) / 100,
      durationMin: Math.round(parseInt(String(r.duration), 10) / 60),
      geometry: decodePolyline(r.polyline.encodedPolyline),
      fiable: true,
    };
  }

  // --------------------------------------------------------- API publique
  async searchPlaces(query: string): Promise<Place[]> {
    const q = query.trim();
    if (q.length < 3) return [];
    if (this.gm.disponible()) {
      try {
        const r = await this.googleSearch(q);
        if (r.length) return r;
      } catch (e) {
        console.warn('[Géo] Google indisponible pour la recherche, repli OpenStreetMap', e);
      }
    }
    return this.osmSearch(q);
  }

  async reverse(lat: number, lng: number): Promise<string> {
    if (this.gm.disponible()) {
      try {
        return await this.googleReverse(lat, lng);
      } catch (e) {
        console.warn('[Géo] Google indisponible pour le géocodage inverse, repli OpenStreetMap', e);
      }
    }
    return this.osmReverse(lat, lng);
  }

  async route(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<RouteInfo> {
    if (this.gm.disponible()) {
      try {
        return await this.googleRoute(from, to);
      } catch (e) {
        console.warn('[Géo] Google indisponible pour l\'itinéraire, repli OSRM', e);
      }
    }
    return this.osrmRoute(from, to);
  }

  // ------------------------------------------------ OpenStreetMap (repli)
  private async osmSearch(q: string): Promise<Place[]> {
    const url =
      'https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=sn&accept-language=fr&q=' +
      encodeURIComponent(q);
    try {
      const res = await fetch(url);
      if (!res.ok) return [];
      const data = (await res.json()) as any[];
      return data.map((d) => ({
        label: this.shortLabel(d) || d.display_name,
        lat: parseFloat(d.lat),
        lng: parseFloat(d.lon),
      }));
    } catch {
      return [];
    }
  }

  private async osmReverse(lat: number, lng: number): Promise<string> {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=17&addressdetails=1&accept-language=fr&lat=${lat}&lon=${lng}`;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('reverse');
      const d = await res.json();
      return this.shortLabel(d) || d.display_name || this.coords(lat, lng);
    } catch {
      return this.coords(lat, lng);
    }
  }

  private async osrmRoute(from: { lat: number; lng: number }, to: { lat: number; lng: number }): Promise<RouteInfo> {
    const url =
      `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}` +
      '?overview=full&geometries=geojson';
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('osrm');
      const data = await res.json();
      const r = data.routes?.[0];
      if (!r) throw new Error('no route');
      return {
        distanceKm: Math.round((r.distance / 1000) * 100) / 100,
        durationMin: Math.round(r.duration / 60),
        geometry: (r.geometry.coordinates as [number, number][]).map(([lng, lat]) => [lat, lng]),
        fiable: true,
      };
    } catch {
      const km = this.haversineKm(from, to) * 1.3;
      return {
        distanceKm: Math.round(km * 100) / 100,
        durationMin: Math.round((km / 25) * 60),
        geometry: [[from.lat, from.lng], [to.lat, to.lng]],
        fiable: false,
      };
    }
  }

  currentPosition(): Promise<{ lat: number; lng: number }> {
    return new Promise((resolve, reject) => {
      if (!('geolocation' in navigator)) return reject(new Error('La géolocalisation n\'est pas disponible sur cet appareil.'));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
        (e) =>
          reject(
            new Error(
              e.code === e.PERMISSION_DENIED
                ? 'Autorisez la localisation dans votre navigateur, ou cliquez sur la carte pour indiquer votre position.'
                : 'Position introuvable. Cliquez sur la carte pour l\'indiquer manuellement.'
            )
          ),
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 }
      );
    });
  }

  /** Suit la position réelle ; renvoie une fonction d'arrêt. vitesse en km/h (ou null). */
  watchPosition(cb: (p: { lat: number; lng: number; vitesseKmh: number | null }) => void, onError?: (msg: string) => void): () => void {
    if (!('geolocation' in navigator)) {
      onError?.("La géolocalisation n'est pas disponible sur cet appareil.");
      return () => {};
    }
    const id = navigator.geolocation.watchPosition(
      (p) =>
        cb({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          vitesseKmh: p.coords.speed !== null && p.coords.speed >= 0 ? Math.round(p.coords.speed * 3.6 * 10) / 10 : null,
        }),
      () => onError?.('Position GPS indisponible. Vérifiez les autorisations de localisation.'),
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
    );
    return () => navigator.geolocation.clearWatch(id);
  }

  haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
    const R = 6371;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /** Réduit un long tracé à ~max points en gardant les extrémités. */
  simplify(points: [number, number][], max = 80): [number, number][] {
    if (points.length <= max) return points;
    const step = (points.length - 1) / (max - 1);
    const out: [number, number][] = [];
    for (let i = 0; i < max - 1; i++) out.push(points[Math.round(i * step)]);
    out.push(points[points.length - 1]);
    return out;
  }

  private coords(lat: number, lng: number) {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  }

  private shortLabel(d: any): string {
    const a = d.address ?? {};
    const rue = a.road || a.pedestrian || a.footway || d.name;
    const quartier = a.suburb || a.neighbourhood || a.city_district || a.quarter;
    const ville = a.city || a.town || a.village || a.municipality || a.county;
    const parts = [rue, quartier, ville].filter((x) => !!x);
    return [...new Set(parts)].join(', ');
  }
}
