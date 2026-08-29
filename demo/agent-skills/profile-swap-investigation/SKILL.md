---
name: profile-swap-investigation
description: Analyse les usurpations de profil IBM i QWTSETP/PS et l'activité rare autour de chaque acteur et cible.
workspaces: [security]
---

## Séquence obligatoire

1. Inventorie `SECAUDIT.QAUDJRN_PROFILE_SWAP` et compte les événements par profils sources et cibles.
2. Récupère en une requête les rôles et autorités des profils sources et cibles, sans identité nominative.
3. Avant toute liste détaillée, mesure la rareté sur toute la période pour les deux côtés : dans `SECAUDIT.DAILY_BASELINE`, groupe tous les profils sources et cibles par `user_profile, stream` et calcule `COUNT(*) AS nb_jours_actifs, MIN(day), MAX(day)` pour `transfer_session` et `object_transfer`.
4. Récupère ensuite en une requête les lignes de baseline aux jours exacts des événements PS. Compare simultanément la rareté calendaire et l'intensité du jour.
5. Si un cas est notable, cible seulement ses métadonnées horaires dans `QAUDJRN_TRANSFER` et `QAUDJRN_OBJECT` ; conclus dès que les preuves suffisent.

## Contrôles obligatoires

- `DAILY_BASELINE` contient les jours actifs seulement. Un flux présent un seul jour, précisément le jour du PS, est une corrélation rare même si `n_events = mean_events` et si l'écart-type est nul.
- Applique le contrôle des jours actifs aux profils sources ET aux profils cibles. L'absence de transfert sous la cible n'exclut jamais une activité inhabituelle du profil source autour du PS.
- Distingue rareté, anomalie de volume et causalité : une coïncidence ne prouve pas que l'usurpation a causé le transfert.
- Tout nombre de sigma, différence ou ratio passe par `calculator` ou par un calcul SQL explicite ; aucun calcul mental.
- Pour `QAUDJRN_OBJECT`, sélectionne `timestamp`, `user_profile`, `object_name`, jamais `object_preview` sauf demande explicite et indispensable de l'utilisateur.
- `cert_insiders` est réservé à l'évaluation et n'est jamais une preuve opérationnelle.

## Interdits

- Ne liste pas sans filtre des centaines de sessions ou d'objets avant d'avoir isolé les cas rares.
- Ne qualifie pas un flux de normal sur la seule égalité avec sa moyenne des jours actifs.
- Ne demande pas de contenu sensible pour confirmer un transfert déjà établi par ses métadonnées.
- Ne termine pas sur une intention de calcul ou de vérification.

## Forme de la conclusion

Donne le schéma des PS, les cas rares prioritaires, les éléments contraires, le niveau de risque et trois actions réversibles au maximum. Vise huit requêtes SQL ou moins.
