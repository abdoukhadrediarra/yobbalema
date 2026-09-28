// AVANT DE DÉPLOYER : remplacez supabaseUrl / supabaseAnonKey par les vraies valeurs de
// votre projet (Project Settings > API dans le dashboard Supabase). L'anon key est
// conçue par Supabase pour être publique : elle peut être commise sans risque, la
// sécurité vient des politiques RLS, jamais de la clé service_role (jamais utilisée ici).
export const environment = {
  production: false,
  // Remplacez ces valeurs par celles de votre projet Supabase
  // (Project Settings > API dans le dashboard Supabase).
  supabaseUrl: 'https://zemzpexdppwdlskjfjwt.supabase.co',
  supabaseAnonKey: 'sb_publishable_zfLqwFSK19GeiVZtNtPbQQ_o8lCkbdT',
  // Clé Google Maps (Maps Demo Key ou clé standard). Laisser vide pour utiliser
  // OpenStreetMap à la place. Voir GOOGLE_MAPS.md.
  googleMapsApiKey: 'AIzaSyAmSgW3iMyV7ZnnB_k3DYp1rVu-5MgNs0Y',
  // Vérification du téléphone par SMS : mettre true une fois un fournisseur SMS configuré dans Supabase (Authentication > Providers > Phone).
  smsOtpEnabled: false,
  // Coordonnées affichées dans le pied de page et la page Contact : À REMPLACER par les vraies.
  supportEmail: 'contact@yobbalema.sn',
  supportPhone: '+221 33 800 00 00',
  supportWhatsapp: '+221781140472',
};
