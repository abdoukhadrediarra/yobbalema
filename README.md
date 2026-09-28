# Yobbalema — Site web & back-end Supabase

Site web (Angular) et back-end (Supabase) de la plateforme YOBBALEMA :
trajets interurbains, courses à la demande avec négociation de prix
(« waxalé »), suivi des bus TATA en direct, et livraison (colis, pharmacie,
repas, marché).

Ce dépôt correspond à la première étape du plan de développement décrite
dans le Document de référence technique (v3) : la fondation commune (site
web + backend) avant l'application mobile Flutter.

## Structure du projet

```
src/app/
  core/
    guards/            garde de route
    models/            types TypeScript reflétant le schéma SQL
    services/          supabase, rides, trips, bus, delivery, driver, profile, admin, notifications, geo, toast
    util/format.ts     FCFA, distances, messages d'erreur en français
  shared/              navbar, footer, carte (Google / Leaflet), champ d'adresse, étoiles, toasts, cloche de notifications
  features/
    home/, auth/       vitrine, connexion, inscription
    dashboard/         espace utilisateur selon le rôle
    courses/           course à la demande + waxalé (client)
    chauffeur/         mode en ligne (courses + livraisons) et espace chauffeur
    trajets/           recherche, publication, gestion des trajets interurbains
    bus/               vue publique des bus + espace receveur (GPS ou simulation)
    livraisons/        livraison (client) + espace commerçant (devis)
    paiement/          retour de l'opérateur, page de paiement simulé
    profil/            informations, mot de passe, pièces d'identité
    historique/        courses, livraisons, paiements
    admin/             back-office (vérifications, commissions, réglages, statistiques)
    legal/             conditions, confidentialité, contact (modèles à faire valider)

supabase/              SQL 01 à 08, functions/ (paiements), README, tests/
PAIEMENTS.md           paiements en ligne : fonctionnement, déploiement, passage en réel
TESTS_MANUELS.md       scénario de test avec 4 comptes
```

## Cartes
OpenStreetMap par défaut ; Google Maps (clé démo gratuite, sans carte bancaire) en renseignant `googleMapsApiKey` — voir **GOOGLE_MAPS.md**.

## Démarrage

### 1. Base de données Supabase

Suivez `supabase/README.md` : créez un projet Supabase, exécutez les 4
fichiers SQL dans l'ordre, puis récupérez l'URL et la clé publique du projet.

### 2. Configuration

Renseignez vos identifiants Supabase dans :
- `src/environments/environment.ts` (développement)
- `src/environments/environment.prod.ts` (production)

```ts
export const environment = {
  production: false,
  supabaseUrl: 'https://VOTRE-PROJET.supabase.co',
  supabaseAnonKey: 'VOTRE_CLE_ANON_PUBLIQUE',
};
```

### 3. Installation et lancement

```bash
npm install
npm start        # ng serve — http://localhost:4200
```

### 4. Build de production

```bash
npm run build     # sortie dans dist/yobbalema-web/browser
```

> Remarque : l'optimisation Angular « inlining des polices » est désactivée
> dans `angular.json` (`optimization.fonts: false`) car elle nécessite un
> accès réseau à Google Fonts au moment du build, indisponible dans certains
> environnements sandboxés. Les polices restent chargées normalement au
> runtime via les balises `<link>` de `src/index.html`. Vous pouvez remettre
> `fonts: true` si votre environnement de build a accès à Internet.

## Design

La palette et la typographie s'inspirent des « cars rapides » (bleu indigo /
or) et de la terre de latérite du Sénégal plutôt que d'un gabarit SaaS
générique — voir les tokens dans `src/styles.scss` (`:root`). Les icônes
utilisent exclusivement le paquet npm `bootstrap-icons` (classes `bi bi-*`),
jamais de glyphes générés.

## Prochaines étapes

Comme convenu, la suite du développement porte sur l'application mobile
Flutter (courses à la demande, réservation de trajets, suivi des bus,
livraison), puis le branchement complet du site web sur les données réelles
(recherche de trajets, tableau de bord chauffeur, etc.) au-delà de la vitrine
et de l'authentification déjà fonctionnelles ici.
