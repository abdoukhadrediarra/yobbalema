import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SupabaseService } from '../services/supabase.service';

/**
 * Empêche l'accès à une route tant qu'aucune session Supabase n'est active.
 * Attend la résolution de la session initiale (authReady) avant de trancher,
 * pour éviter une redirection intempestive au rechargement de la page.
 */
export const authGuard: CanActivateFn = async () => {
  const supabase = inject(SupabaseService);
  const router = inject(Router);

  while (!supabase.authReady()) {
    await new Promise((resolve) => setTimeout(resolve, 30));
  }

  if (supabase.currentUser()) {
    return true;
  }
  return router.createUrlTree(['/connexion']);
};
