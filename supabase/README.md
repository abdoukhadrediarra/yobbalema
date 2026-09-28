# Base de données Supabase — YOBBALEMA

Schéma, sécurité et logique métier des quatre services : trajets interurbains,
courses à la demande (waxalé), bus TATA, livraison.

## Mise en place / mise à jour

Dans **SQL Editor** de votre projet Supabase, exécutez **dans l'ordre**, un fichier à la fois :

| # | Fichier | Contenu |
|---|---|---|
| 1 | `01_schema_core.sql` | extensions, types, profils (+ trigger d'inscription), véhicules, tarifs, paramètres |
| 2 | `02_schema_rides_payments.sql` | trajets, réservations, courses, paiements, dette de commission |
| 3 | `03_schema_bus_delivery.sql` | bus, commerçants, livraisons, avis |
| 4 | `04_rls_policies.sql` | sécurité au niveau des lignes (RLS) |
| 5 | `05_services_config_security.sql` | paramètres des services, colonnes ajoutées, **durcissement RLS**, stockage privé, temps réel |
| 6 | `06_service_functions.sql` | fonctions métier appelées par le site (`supabase.rpc`) |
| 7 | `07_complements.sql` | plusieurs bus par ligne, bus sur un trajet A→B, position des chauffeurs, notifications, avis livraison/commerçant, repli sur le commerçant suivant, modification de trajet, administration |
| 8 | `08_paiements_penalites.sql` | paiements en ligne (tentatives, confirmation, déduction automatique de la dette), soldes et versements, règles d'annulation et suspension |

Si votre projet a déjà 01 à 07 : exécutez seulement **08** (rejouable). S'il n'a que 01 à 06 : **07 puis 08**. S'il n'a que 01 à 04 : **05 à 08**.

### Ce que 05 change pour votre projet existant
- Les écritures directes sur `ride_requests`, `reservations`, `delivery_orders` et `reviews` sont **fermées** : tout passe par les fonctions de 06.
- Un utilisateur ne peut plus modifier son `statut_verif`, sa `note_moyenne` ni son `role`.
- Un profil complet (téléphone) n'est lisible que par soi-même et par les personnes avec qui on partage une course, une réservation ou une livraison. Les autres voient `profils_publics` (prénom, note, rôle).
- `regler_dette_manuelle` est supprimée, remplacée par `regler_dette` (mode test uniquement) et `regler_dette_admin` (clé service_role uniquement).
- Buckets privés `documents` et `ordonnances` créés (chemin `<user_id>/fichier`).

### Ce que 07 change pour votre projet existant
- `bus_positions` : un bus = une position par (ligne, receveur) ; l'ancienne contrainte « une position par ligne » disparaît. `bus_arrivals` renvoie désormais une ligne par bus (avec `bus_id` et `bus_label`).
- `pending_rides_nearby` renvoie en plus la note du client (`client_note`).
- `refuser_commande` transmet la commande au commerçant suivant au lieu de l'annuler.
- Nouvelles tables : `notifications`, `device_tokens`, `driver_locations`, `admins`.

### Ce que 08 change pour votre projet existant
- Un paiement Wave / Orange Money **hors mode test** est désormais créé « en attente » (au lieu d'être refusé) et confirmé par le webhook d'un opérateur : voir `../PAIEMENTS.md` (déploiement des Edge Functions dans `functions/`).
- En mode test, rien ne change, sauf qu'un paiement numérique simulé déduit aussi automatiquement les dettes de commission.
- Nouvelles tables : `payment_intents`, `versements`, `abus_events`. Nouvelle colonne : `profiles.suspendu_jusqua`.
- `assert_actor` refuse les comptes suspendus.

## Créer un administrateur
Le compte doit d'abord exister (inscription normale), puis dans le SQL Editor :
```sql
insert into admins (user_id)
select id from profiles where id = (select id from auth.users where email = 'vous@exemple.sn');
```
Aucune interface ni l'API ne permet de se déclarer administrateur. Le lien « Admin » apparaît alors dans la barre de navigation.

## Expirations automatiques (recommandé : pg_cron)
Le site déclenche déjà les expirations pendant l'usage, mais il faut aussi une tâche planifiée pour qu'elles aient lieu quand personne ne regarde. Dans Supabase : *Database > Extensions > pg_cron* (activer), puis :
```sql
select cron.schedule('yobba-expirations', '* * * * *',
  $$ select public.expire_stale_rides(); select public.expire_stale_deliveries(); select public.expire_stale_payments(); $$);
```

## Notifications
Chaque événement important (course acceptée, réservation, devis reçu, dette créée, compte vérifié…) crée une ligne dans `notifications` par déclencheur SQL ; le site les reçoit en direct (cloche dans la barre de navigation). La table `device_tokens` est prête pour les notifications push de l'application mobile (FCM) : un envoi push se branchera sur ces mêmes lignes via une Edge Function.

## Paramètres (table `app_config`)
| Clé | Défaut | Effet |
|---|---|---|
| `verification_requise` | `false` | `true` : seuls les comptes `verifie` peuvent agir comme chauffeur / receveur / commerçant |
| `mode_test_paiements` | `true` | `true` : Wave / Orange Money simulés. `false` : seul « espèces » fonctionne tant qu'aucune Edge Function de paiement n'existe |
| `nb_relances_max` | `2` | expiration d'une course = (nb + 1) × `delai_relance_secondes` |
| `rayon_initial_km`, `rayon_increment_km`, `delai_relance_secondes` | 0,5 / 0,5 / 120 | diffusion des courses |
| `livraison_rayon_*`, `livraison_delai_relance_s` | 2 / 1 / 10 max / 120 | diffusion des livraisons |
| `tarif_minimum`, `offre_min_pct` | 500 / 50 | prix minimum, offre waxalé minimale (% du tarif de base) |
| `bus_*` | 18 km/h, 120 s, 400 m | vitesse par défaut, péremption des positions, rayon d'arrêt |
| `devis_reponse_delai_s`, `devis_validite_min` | 300 / 30 | délai de réponse du commerçant avant transmission au suivant ; validité d'un devis |
| `paiements_fournisseurs`, `paiement_delai_min` | `wave,orange_money` / 30 | moyens en ligne proposés (hors mode test) ; validité d'une tentative de paiement |
| `desistements_chauffeur_max`, `annulations_client_max` | 0 / 0 | désistements / annulations tolérés avant suspension (**0 = règle désactivée**) |
| `abus_fenetre_jours`, `abus_suspension_heures` | 7 / 24 | fenêtre de comptage et durée de la suspension |

Modifier : `update app_config set valeur = 'true' where cle = 'verification_requise';`

## Vérifier un compte (administrateur)
```sql
update profiles set statut_verif = 'verifie'
where id = (select id from auth.users where email = 'chauffeur@exemple.sn');
-- commerçant :
update merchants set statut_verif = 'verifie' where nom_commerce = 'Pharmacie Liberté';
```
Les pièces envoyées sont dans **Storage > documents** (dossier = id de l'utilisateur).

## Fonctions RPC (toutes vérifient `auth.uid()` et le rôle)
| Domaine | Fonctions |
|---|---|
| Chauffeur | `mon_statut_chauffeur()`, `regler_dette(ledger_id)` *(test)*, `regler_dette_admin(ledger_id)` *(service_role)* |
| Trajets | `reserver_trajet`, `confirmer_reservation`, `annuler_reservation`, `terminer_trajet`, `annuler_trajet`, `encaisser_reservation` |
| Courses | `create_ride_request`, `pending_rides_nearby`, `accept_ride_request`, `demarrer_course`, `terminer_course`, `annuler_course`, `chauffeur_desiste`, `expire_stale_rides` |
| Bus | `bus_arrivals(lat, lng)`, `bus_trajet(from_lat, from_lng, to_lat, to_lng)` — **publics** (sans connexion) |
| Livraison | `create_delivery_order`, `envoyer_devis`, `refuser_commande`, `approuver_devis`, `annuler_livraison`, `pending_deliveries_nearby`, `accept_delivery_order`, `terminer_livraison` |
| Avis | `noter(source_type, source_id, note, commentaire)` — `ride`, `trip`, `delivery`, `commerce` |
| Trajets (suite) | `modifier_trajet(trip_id, prix, date, places_total)` |
| Livraison (suite) | `expire_stale_deliveries()` |
| Notifications | `notifications_marquer_lues(ids)` |
| Paiements | `demander_paiement`, `demander_paiement_dette`, `expire_stale_payments`, `mon_solde` ; *(service_role)* `confirmer_intent`, `enregistrer_session_paiement` |
| Administration | `admin_soldes`, `admin_enregistrer_versement`, `admin_lever_suspension`, `is_admin`, `admin_stats`, `admin_set_verification`, `admin_set_merchant_verification`, `admin_regler_dette`, `admin_set_config`, `admin_set_pricing` |

## Tests (optionnels, ne servent pas sur Supabase)
Le dossier `tests/` contient une simulation de Supabase (`shim_supabase.sql`) pour tester en local avec PostgreSQL + PostGIS :
- `python3 tests/run_sql_tests.py` — 359 vérifications SQL (droits, verrou de concurrence, paiements en ligne, déduction de dette, versements, suspensions, bus, administration…)
- `tests/api/services.integration.ts` — exécute les services Angular contre PostgREST (120 vérifications), via `npx tsx`.
- `tests/api/payments.functions.test.ts` — exécute les Edge Functions de paiement contre PostgREST avec de fausses réponses Wave / Orange Money (45 vérifications).
- `tests/api/geo.provider.test.ts` — 13 vérifications de la couche cartographique (Google / repli OpenStreetMap).

## Encore à faire
- Essais dans le bac à sable réel de Wave et d'Orange Money (voir `../PAIEMENTS.md`), puis `mode_test_paiements = false`.
- Versements automatiques (API de versement Wave) : aujourd'hui enregistrés à la main.
- Notifications push (Edge Function FCM branchée sur `notifications` + `device_tokens`) — avec l'application mobile.
- SMS OTP : le code du site est prêt (`smsOtpEnabled`), il faut configurer un fournisseur SMS dans Supabase.
- Choisir les seuils des règles d'annulation (elles existent, désactivées par défaut).
- Remplacer Nominatim / OSRM (gratuits, pour tests) par un service adapté à la production, ou utiliser une clé Google standard.
