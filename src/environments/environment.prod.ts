// AVANT DE DÉPLOYER : remplacez supabaseUrl / supabaseAnonKey par les vraies valeurs de
// votre projet (Project Settings > API dans le dashboard Supabase). L'anon key est
// conçue par Supabase pour être publique : elle peut être commise sans risque, la
// sécurité vient des politiques RLS, jamais de la clé service_role (jamais utilisée ici).
export const environment = {
  production: true,
  supabaseUrl: 'https://VOTRE-PROJET.supabase.co',
  supabaseAnonKey: 'VOTRE_CLE_ANON_PUBLIQUE',
  // Clé Google Maps (Maps Demo Key ou clé standard). Laisser vide pour utiliser
  // OpenStreetMap à la place. Voir GOOGLE_MAPS.md.
  googleMapsApiKey: '',
  // Vérification du téléphone par SMS : mettre true une fois un fournisseur SMS configuré dans Supabase (Authentication > Providers > Phone).
  smsOtpEnabled: false,
  // Coordonnées affichées dans le pied de page et la page Contact : À REMPLACER par les vraies.
  supportEmail: 'contact@yobbalema.sn',
  supportPhone: '+221 33 800 00 00',
  supportWhatsapp: '',
};
