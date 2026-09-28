import { Injectable } from '@angular/core';
import { environment } from '../../../environments/environment';

/**
 * Charge le script Google Maps JavaScript une seule fois, à la demande.
 * `disponible()` vaut false si aucune clé n'est configurée : le site utilise alors
 * OpenStreetMap. Si le chargement échoue (clé invalide, hors ligne, quota), la
 * promesse est rejetée et l'appelant retombe sur OpenStreetMap.
 */
@Injectable({ providedIn: 'root' })
export class GoogleMapsLoader {
  readonly key: string = (environment as { googleMapsApiKey?: string }).googleMapsApiKey?.trim() ?? '';
  private loading?: Promise<void>;
  private failed = false;

  disponible(): boolean {
    return this.key.length > 0 && !this.failed;
  }

  load(): Promise<void> {
    if (!this.disponible()) return Promise.reject(new Error('Clé Google Maps absente'));
    if (this.loading) return this.loading;

    this.loading = new Promise<void>((resolve, reject) => {
      const w = window as unknown as Record<string, unknown>;
      // Google appelle cette fonction si la clé est refusée (clé invalide, API non activée, referrer non autorisé…).
      w['gm_authFailure'] = () => {
        this.failed = true;
        console.error('[Google Maps] Clé refusée : vérifiez la clé, les API activées et les restrictions de referrer.');
      };
      w['__yobbaGmapsReady'] = () => resolve();

      const s = document.createElement('script');
      s.src =
        'https://maps.googleapis.com/maps/api/js?key=' + encodeURIComponent(this.key) +
        '&loading=async&v=weekly&language=fr&region=SN&callback=__yobbaGmapsReady';
      s.async = true;
      s.onerror = () => { this.failed = true; this.loading = undefined; reject(new Error('Chargement de Google Maps impossible')); };
      document.head.appendChild(s);
    });
    return this.loading;
  }
}
