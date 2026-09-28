# Utiliser Google Maps (Maps Demo Key, sans carte bancaire)

Le site fonctionne avec **deux fournisseurs de carte** :

| | Google Maps | OpenStreetMap (par défaut) |
|---|---|---|
| Activation | renseigner `googleMapsApiKey` | laisser la clé vide |
| Carte | Google Maps | Leaflet + tuiles OpenStreetMap |
| Recherche d'adresses | Google Places (Text Search) | Nominatim |
| Adresse d'un point | Google Geocoding | Nominatim |
| Itinéraires / distances | Google Routes API | OSRM (démo) |

Si un appel Google échoue (quota atteint, clé refusée, hors ligne), la recherche, le
géocodage et les itinéraires **retombent automatiquement sur OpenStreetMap** : le site
continue de fonctionner. Ouvrez la console du navigateur (F12) : les messages
`[Géo]`, `[Carte]` et `[Google Maps]` indiquent ce qui s'est passé.

## 1. Obtenir la clé démo
1. Ouvrez <https://mapsplatform.google.com/maps-demo-key/> et cliquez sur **Try for free**.
2. Connectez-vous avec un compte Google (aucune carte bancaire demandée pour la clé démo).
3. Copiez la clé.

La clé démo couvre : cartes dynamiques (JavaScript), Autocomplete, Text Search,
Nearby Search, Geocoding et Compute Routes. Elle a une **limite quotidienne par API**
(voir <https://developers.google.com/maps/demo-key>) ; passé cette limite, Google met la
carte en pause jusqu'au lendemain sans facturer.

## 2. Brancher la clé
Dans `src/environments/environment.ts` :
```ts
googleMapsApiKey: 'AIza…votre clé…',
```
Relancez `ng serve`. Pour revenir à OpenStreetMap, remettez `''`.

Si la console de Google le permet pour votre clé, restreignez-la aux référents
HTTP `http://localhost:4200/*` (une clé Maps JavaScript est visible dans le navigateur :
c'est normal, la restriction de référent est sa protection).

## 3. Limites à connaître
- **La clé démo est faite pour le prototypage, pas pour la production.** Pour la mise en
  ligne, il faut une clé standard : elle exige un compte de facturation (carte bancaire),
  avec un usage gratuit mensuel par type d'appel (plafond indiqué par Google : 10 000
  appels par SKU et par mois pour la plupart des produits ; vérifiez la grille actuelle).
- Google est généralement plus riche qu'OpenStreetMap pour les commerces et les
  quartiers, mais **aucune base ne connaît tous les villages**. C'est pourquoi les pages
  *Course*, *Publier un trajet* et *Livraison* proposent aussi de **placer le point
  directement sur la carte**.
- Le site utilise l'identifiant de carte de démonstration `DEMO_MAP_ID` (marqueurs
  avancés). Pour un style de carte personnalisé, créez votre propre identifiant de carte.
- Les résultats Google ne doivent s'afficher que sur une carte Google : la carte, la
  recherche et les itinéraires basculent donc ensemble (voir le tableau ci-dessus).
