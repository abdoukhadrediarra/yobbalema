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

## Dépôt Git et hébergement (tests de géolocalisation à plusieurs)

Ce dossier est déjà un dépôt Git (`git init` + premier commit faits). Le
géolocalisation (position GPS, bus en direct, position du chauffeur) ne peut
pas se tester correctement sur une seule machine fixe : il faut plusieurs
testeurs, à plusieurs endroits réels, sur un lien **HTTPS** (les navigateurs
interdisent l'API de géolocalisation en HTTP hors `localhost`). D'où l'intérêt
d'un hébergement gratuit, séparé de votre machine.

**Le backend (Supabase) est déjà hébergé dans le cloud** — rien à faire de ce
côté. Il ne manque que le site Angular, aujourd'hui seulement lancé en local
(`ng serve`).

### 1. Créer le dépôt sur GitHub
Sur github.com : **New repository** → nom `yobbalema` (public ou privé, les
deux fonctionnent avec l'hébergeur ci-dessous) → **ne cochez aucune case**
(pas de README, pas de .gitignore : ce dossier en a déjà) → **Create**.
GitHub affiche alors les commandes ; depuis ce dossier :

```bash
git remote add origin https://github.com/abdoukhadrediarra/yobbalema.git
git push -u origin main
```

### 2. Renseigner les vraies valeurs avant de déployer
Remplacez les valeurs de `src/environments/environment.prod.ts` (Project
Settings > API dans Supabase), puis :

```bash
git add -A && git commit -m "Configuration de production" && git push
```

> La clé publique (`anon key`) est conçue par Supabase pour être visible
> côté client : elle est protégée par les politiques RLS, pas par le secret.
> Ne mettez en revanche **jamais** la clé `service_role` dans ces fichiers.

### 3. Héberger sur Cloudflare Pages (recommandé, gratuit, sans carte bancaire)
1. [dash.cloudflare.com](https://dash.cloudflare.com) → créer un compte gratuit.
2. **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → autorisez
   GitHub → choisissez le dépôt `yobbalema`.
3. Réglages de build :
   - Framework preset : **Angular**
   - Build command : `npm run build`
   - Build output directory : `dist/yobbalema-web/browser`
   - Variable d'environnement : `NODE_VERSION` = `20`
4. **Save and Deploy**. Au bout de 1 à 2 minutes, le site est en ligne sur
   `https://yobbalema.pages.dev` (HTTPS automatique).

Chaque `git push` sur `main` redéploie automatiquement ; chaque autre branche
ou pull request reçoit sa propre URL de prévisualisation — pratique pour
tester un changement avant de le fusionner. `public/_redirects` est déjà en
place pour que les routes Angular (`/courses`, `/bus`, etc.) fonctionnent
après un rafraîchissement de page.

**Alternatives** (mêmes réglages de build) : [Netlify](https://netlify.com)
ou [Vercel](https://vercel.com) (`vercel.json` déjà fourni) — utile si
Cloudflare Pages est mal desservi depuis certains lieux de test.

### 4. Faire tester la géolocalisation à distance
Donnez l'URL `https://yobbalema.pages.dev` à des testeurs dans des villes
différentes (téléphone, navigateur Chrome ou Safari) : *Course à la
demande*, *Mode chauffeur*, *Bus TATA* leur demanderont l'autorisation de
localisation, avec leur position réelle plutôt que celle simulée en cliquant
sur la carte.

### Le mobile Flutter n'a pas besoin de ce type d'hébergement
Une application Flutter compilée (APK / IPA) n'est pas un site à héberger :
elle s'installe sur le téléphone et appelle le **même** backend Supabase déjà
en ligne — aucune infrastructure supplémentaire à prévoir pour elle. Le
prochain hébergement à envisager, plus tard, concernera sa **distribution**
aux testeurs (Google Play Console, piste de test interne ; TestFlight pour
iOS), pas son fonctionnement. En attendant, gardez ce dépôt en monorepo :
quand le développement Flutter commencera, son code prendra place dans un
dossier `mobile/` à la racine, à côté de `src/` et `supabase/`, sans toucher
à l'existant.

## Design

La palette et la typographie s'inspirent des « cars rapides » (bleu indigo /
or) et de la terre de latérite du Sénégal plutôt que d'un gabarit SaaS
générique — voir les tokens dans `src/styles.scss` (`:root`). Les icônes
utilisent exclusivement le paquet npm `bootstrap-icons` (classes `bi bi-*`),
jamais de glyphes générés.

## Prochaines étapes

Les quatre services (trajets, courses waxalé, bus, livraison), les paiements
en ligne, le back-office et les notifications sont fonctionnels côté site et
testés (voir `TESTS_MANUELS.md`). Restent, dans l'ordre envisagé :
1. Tests de géolocalisation à plusieurs, sur le site hébergé (ci-dessus).
2. Application mobile Flutter, réutilisant le même backend Supabase.
3. Vrais paiements Wave / Orange Money en bac à sable (`PAIEMENTS.md`),
   fournisseur SMS, relecture juridique des pages Conditions/Confidentialité.
