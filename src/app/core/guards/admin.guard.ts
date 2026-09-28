import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

/** Réservé aux administrateurs (table admins). La vraie protection est côté base : ce garde n'évite que la page vide. */
export const adminGuard: CanActivateFn = async () => {
  const sb = inject(SupabaseService);
  const router = inject(Router);
  while (!sb.authReady()) await new Promise((r) => setTimeout(r, 30));
  if (!sb.currentUser()) return router.createUrlTree(['/connexion']);
  try {
    const ok = await sb.rpc<boolean>('is_admin');
    return ok === true ? true : router.createUrlTree(['/tableau-de-bord']);
  } catch {
    return router.createUrlTree(['/tableau-de-bord']);
  }
};
