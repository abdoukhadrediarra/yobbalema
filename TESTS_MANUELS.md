# Scénario de test manuel (10 à 15 minutes)

Préparez **4 comptes** (un navigateur ou une fenêtre privée par compte). Astuce e-mail :
`vous+client@gmail.com`, `vous+chauffeur@gmail.com`, `vous+bus@gmail.com`, `vous+pharma@gmail.com`.
Rôles à choisir à l'inscription : passager, chauffeur, receveur de bus, commerçant.
Prérequis : SQL 05 et 06 exécutés, `verification_requise = false` (défaut).

## 1. Course avec waxalé (passager + chauffeur)
1. **Chauffeur** → *Espace chauffeur* : ajouter un véhicule *Standard*, régler un tarif.
2. **Chauffeur** → *Mode chauffeur* : passer *En ligne*. Cliquer sur la carte pour placer votre position (ex. Plateau).
3. **Passager** → *Courses* : départ à quelques centaines de mètres de la position du chauffeur, arrivée ailleurs, activer *waxalé*, proposer un prix.
4. **Chauffeur** : la demande apparaît (≤ 4 s). Si le départ est à plus de 0,5 km, elle apparaît après 2 min (le rayon s'élargit).
5. **Chauffeur** : *Accepter* → *Démarrer* → *Terminer* en **espèces**. Le passager voit chaque étape, puis peut noter.
6. **Chauffeur** : bandeau rouge « compte bloqué » (5 % du montant). Il ne peut plus accepter → *Régler (simulation)* → débloqué.

## 2. Trajet interurbain
Chauffeur : *Publier un trajet*. Passager : *Trajets* → réserver. Chauffeur : *Mes trajets* → confirmer, *Terminer le trajet*, *Encaisser*. Passager : noter.

## 3. Bus TATA
Receveur : *Espace receveur* → nouvelle ligne (deux terminus + *Tracer automatiquement*) → mode *Simulation* → *Démarrer*.
Passager (ou visiteur non connecté) : page *Bus* → cliquer sur la carte près du tracé : le temps d'arrivée diminue à mesure que le bus avance.

## 4. Livraison pharmacie
Commerçant : *Commerce* → déclarer la pharmacie (adresse sur la carte). Passager : *Livraison* → Pharmacie + ordonnance (photo).
Commerçant : *Établir le devis* (articles + livraison). Passager : *Mes commandes* → *Valider le devis*.
Chauffeur (en ligne, près de la pharmacie) : accepter, *Livraison effectuée* en Wave → 2 paiements (produits → commerçant, livraison → chauffeur).

## 5. Nouveautés à essayer
- **Notifications** : dans un scénario ci-dessus, regardez la cloche du passager pendant que le chauffeur accepte / démarre / termine : le compteur monte en direct.
- **Chauffeur visible** : pendant qu'une course est acceptée, déplacez le marqueur du chauffeur (*Mode chauffeur*) : le passager voit la voiture bouger sur sa carte, avec une estimation d'arrivée.
- **Deux bus sur une ligne** : deux comptes receveurs, même ligne (choisie dans la liste), deux libellés de bus, deux simulations. Côté voyageur, onglet *Mon trajet (de A vers B)* : les deux bus, l'arrivée de chacun et la durée à bord.
- **Commerçant qui ne répond pas** : créez deux pharmacies (deux comptes commerçants) ; le premier commerçant *refuse* : la commande passe à la seconde. Après 5 minutes sans réponse elle passe aussi au suivant (le site déclenche l'expiration pendant l'usage).
- **Modifier un trajet** : *Mes trajets* → *Modifier*. Le prix et la date se figent dès qu'un passager a réservé.
- **Avis** : après une livraison, le client note le livreur et le partenaire ; les notes apparaissent dans le profil des personnes notées.
- **Mot de passe oublié** : lien sur la page de connexion. Le lien reçu par e-mail ramène sur le site pour choisir un nouveau mot de passe (l'envoi d'e-mails de Supabase est limité en test).
- **Historique** : page *Historique* (courses, livraisons, paiements).
- **Administration** : créez un administrateur (voir `supabase/README.md`), puis page *Admin* : validez une CNI, un commerçant, réglez une dette, modifiez un tarif, lisez les statistiques.

## 6. Paiements en ligne (parcours complet, sans argent réel)
Prérequis : déployer les fonctions en mode simulation (voir `PAIEMENTS.md`), puis `update app_config set valeur='false' where cle='mode_test_paiements';`.
1. Course terminée par le chauffeur en **Wave** : côté chauffeur, message « en attente du paiement du client ».
2. Côté passager : « À payer : X FCFA » avec les boutons → page de **paiement simulé** → « Simuler un paiement réussi » → page « Paiement confirmé ».
3. Le chauffeur reçoit la notification « Paiement reçu » ; dans *Espace chauffeur*, son **À recevoir** augmente de 95 %.
4. **Dette automatique** : faites une course en **espèces** (le chauffeur est bloqué), puis faites payer en ligne une autre course terminée avant : la dette disparaît toute seule et le chauffeur est débloqué.
5. **Administration → Versements** : le solde à reverser apparaît ; enregistrez un versement, le chauffeur est notifié.
6. **Règlement en ligne de la dette** : *Espace chauffeur* → « Payer avec Wave » (page simulée) → débloqué.
Remettre `mode_test_paiements = true` pour revenir aux paiements simulés instantanés.

## 7. Règles d'annulation (désactivées par défaut)
`update app_config set valeur='2' where cle in ('desistements_chauffeur_max','annulations_client_max');`
Un chauffeur qui se désiste 2 fois (ou un client qui annule 2 fois après acceptation) est suspendu 24 h : bandeau rouge sur son tableau de bord, actions refusées. *Admin → Commissions* : « Lever la suspension ».

## À signaler si vous rencontrez
Le texte exact du message d'erreur affiché (les erreurs de base de données sont traduites en français) et l'écran concerné.
