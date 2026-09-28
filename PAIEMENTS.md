# Paiements en ligne (Wave / Orange Money)

## Comment ça marche
1. **Espèces** : inchangé. Le chauffeur encaisse, sa commission de 5 % devient une dette ; tant qu'elle n'est pas réglée, il ne peut plus accepter de mission.
2. **Wave / Orange Money** : le client paie **la plateforme** (pas le chauffeur).
   - En fin de course / trajet / livraison, le chauffeur choisit le moyen ; le paiement passe « en attente ».
   - Le client voit **« À payer : X FCFA »** avec les boutons Wave / Orange Money → il est redirigé vers l'application de l'opérateur.
   - C'est le **webhook de l'opérateur** (signature ou jeton vérifiés, montant contrôlé) qui confirme le paiement, jamais le navigateur. Une page de retour interroge aussi l'opérateur si le webhook tarde.
3. **Déduction automatique de la dette** : quand un chauffeur reçoit un paiement en ligne confirmé, ses commissions impayées (les plus anciennes d'abord, entières) sont réglées automatiquement sur son net. Il peut aussi régler sa dette en ligne (Wave / Orange Money) depuis son espace.
4. **Reversement** : la plateforme doit reverser à chaque bénéficiaire son net (montant − 5 %). L'onglet **Versements** de l'administration liste les soldes ; vous envoyez l'argent depuis votre compte marchand puis **enregistrez le versement** avec sa référence : le solde baisse et le bénéficiaire est notifié. Chauffeurs et commerçants voient leur « À recevoir » dans leur espace.

## Trois niveaux de fonctionnement
| Réglage | Effet |
|---|---|
| `mode_test_paiements = true` (défaut) | Wave / Orange Money **simulés** : confirmés immédiatement, aucune fonction à déployer. |
| `mode_test_paiements = false` + `PAYMENTS_MODE=mock` | Parcours **complet en pending** avec une fausse page d'opérateur (aucun argent, aucun compte opérateur). Idéal pour tester tout le flux. |
| `mode_test_paiements = false`, `PAYMENTS_MODE` absent | **Vrais opérateurs** (nécessite leurs identifiants). |

## Déployer les fonctions (Supabase CLI)
```bash
supabase link --project-ref <votre-ref>
supabase secrets set SITE_URL=http://localhost:4200 PAYMENTS_MODE=mock      # démonstration
supabase functions deploy payments-checkout
supabase functions deploy payments-webhook --no-verify-jwt                    # l'opérateur n'a pas de jeton Supabase
```
Puis dans le SQL Editor : `update app_config set valeur = 'false' where cle = 'mode_test_paiements';`
Pour revenir à la simulation instantanée : remettre `'true'`.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` et `SUPABASE_SERVICE_ROLE_KEY` sont fournis automatiquement aux fonctions.

## Variables (secrets) par opérateur
**Wave** — `WAVE_API_KEY` ; si la signature des requêtes est activée : `WAVE_SIGNING_SECRET` ; pour le webhook : `WAVE_WEBHOOK_SECRET` (secret de signature, recommandé) **ou** `WAVE_WEBHOOK_SHARED_SECRET` (secret partagé, moins sûr).
URL de webhook à déclarer chez Wave : `https://<projet>.supabase.co/functions/v1/payments-webhook?p=wave`

**Orange Money** — `OM_AUTH_HEADER` (en-tête `Basic …` fourni par Orange Developer), `OM_MERCHANT_KEY`, `OM_CURRENCY` (`OUV` en bac à sable, `XOF` en production), et si Orange l'indique : `OM_API_BASE`, `OM_TOKEN_URL`, `OM_PAYMENT_PATH`, `OM_STATUS_PATH`.
Le champ de notification est renseigné automatiquement : `https://<projet>.supabase.co/functions/v1/payments-webhook?p=orange_money`

## Avant de passer en réel
1. **Comptes opérateurs** : Wave Business (clés API dans le portail) et Orange Money marchand. Orange indique que ses marchands doivent être des commerçants **officiellement enregistrés** ; Wave a des exigences similaires pour un compte Business. Une entreprise enregistrée est donc en pratique nécessaire.
2. **Bac à sable d'abord** : ces intégrations sont écrites d'après la documentation publique et vérifiées contre de **fausses réponses** (signatures, montants, rejeu, pannes) — **pas contre les vraies API**. Faites un paiement de test de bout en bout dans le bac à sable de chaque opérateur. Pour Orange, les chemins d'API et la devise sont à confirmer avec eux (variables `OM_*`).
3. **Planifier les expirations** (pg_cron) : `select public.expire_stale_payments();` toutes les minutes (voir `supabase/README.md`).
4. **Question réglementaire à faire valider** : encaisser l'argent des clients puis le reverser à des tiers peut relever de la réglementation des services de paiement (BCEAO, zone UEMOA). Faites valider ce modèle par un juriste et par votre opérateur (Wave propose des identités de « marchands agrégés », réservées à certains partenaires).

## Ce que le système protège
- Le navigateur ne peut ni confirmer un paiement, ni le fabriquer, ni lire les tentatives d'autrui.
- Webhook Wave : signature HMAC-SHA256 sur le corps brut, horodatage de moins de 5 minutes (anti-rejeu). Webhook Orange : jeton émis par nous, et **statut relu auprès d'Orange** (le contenu de la notification n'est jamais cru).
- Montant reçu différent du montant attendu : rien n'est confirmé, l'anomalie apparaît dans les statistiques admin.
- Rejeu d'un webhook : sans effet. Paiement tardif d'une ancienne tentative après un autre paiement : signalé comme « doublon » (remboursement à vérifier).

## Limites connues
- Pas de remboursement automatique (à faire depuis le portail de l'opérateur).
- Si un client ne paie jamais en ligne, la course reste terminée avec un paiement « en attente » (visible dans les statistiques) : la politique de relance ou de bascule en espèces reste à définir.
- Les versements sont enregistrés à la main par un administrateur ; l'envoi automatique (API de versement Wave) n'est pas branché.
