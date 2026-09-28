/** Utilitaires de formatage et de gestion d'erreurs partagés. */

const nf = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

/** 1500 → « 1 500 FCFA » */
export function fcfa(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—';
  return nf.format(Number(value)).replace(/\u202f|\u00a0/g, '\u00a0') + '\u00a0FCFA';
}

/** Distance lisible : 850 m, 3,2 km */
export function distanceLisible(metres: number): string {
  if (metres < 1000) return `${Math.round(metres)}\u00a0m`;
  return `${(metres / 1000).toFixed(1).replace('.', ',')}\u00a0km`;
}

/** Temps écoulé lisible : « il y a 12 s », « il y a 3 min ». */
export function ilYA(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `il y a ${s}\u00a0s`;
  if (s < 3600) return `il y a ${Math.round(s / 60)}\u00a0min`;
  return `il y a ${Math.round(s / 3600)}\u00a0h`;
}

/** Secondes restantes avant une échéance (jamais négatif). */
export function secondesRestantes(iso: string, now = Date.now()): number {
  return Math.max(0, Math.round((new Date(iso).getTime() - now) / 1000));
}

export function mmss(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * Transforme une erreur Supabase / PostgREST / réseau en message français lisible.
 * Les fonctions SQL lèvent des erreurs de la forme « code_erreur: message français » :
 * on affiche simplement la partie lisible.
 */
export function messageErreur(err: unknown, parDefaut = 'Une erreur est survenue. Réessayez.'): string {
  const raw = extraireMessage(err);
  if (!raw) return parDefaut;
  const lower = raw.toLowerCase();

  const coded = /^([a-z_]{4,40}): (.+)$/s.exec(raw);
  if (coded) return coded[2];

  if (lower.includes('row-level security') || lower.includes('permission denied')) {
    return "Action non autorisée pour votre compte.";
  }
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('load failed')) {
    return 'Connexion impossible. Vérifiez votre accès Internet.';
  }
  if (lower.includes('jwt') && lower.includes('expired')) {
    return 'Votre session a expiré. Reconnectez-vous.';
  }
  if (lower.includes('could not find the function') || lower.includes('schema cache')) {
    return "Une fonction est absente de la base : exécutez les fichiers SQL 05 et 06 du dossier supabase/.";
  }
  return raw.length > 220 ? parDefaut : raw;
}

function extraireMessage(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  if (typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message ?? '');
  }
  return '';
}

export const LIBELLES_CATEGORIE: Record<string, string> = {
  standard: 'Standard',
  confort: 'Confort',
  pro: 'Pro',
  moto: 'Moto',
  jakarta: 'Jakarta',
  tiak_tiak: 'Tiak-tiak',
};

export const LIBELLES_MOYEN: Record<string, string> = {
  especes: 'Espèces',
  wave: 'Wave',
  orange_money: 'Orange Money',
};

export const LIBELLES_LIVRAISON: Record<string, string> = {
  colis: 'Colis',
  pharmacie: 'Pharmacie',
  repas: 'Repas',
  marche: 'Marché',
};
