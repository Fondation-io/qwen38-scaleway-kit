---
name: historical-backlog
description: Analyse un backlog historique avec une date reproductible et vérifie le cycle de vie avant recommandation.
workspaces: [gestion]
---

## Méthode

1. Détermine une date d'observation reproductible depuis les timestamps réels du corpus.
2. Fais calculer séparément l'ancienneté depuis la création et le dépassement de l'échéance par Db2 ou par `date_calculator`.
3. Vérifie le cycle de vie complet avant de proposer une action.

## Contrôles obligatoires

- Exclue les dates futures estimées du choix de la date d'observation.
- Vérifie paiement, lignes, approbation, expédition et livraison.
- Utilise la même référence temporelle pour toutes les durées comparées.
- Ne fais aucun calcul mental de date ou de durée : recopie exactement le résultat Db2 ou `date_calculator` et mentionne l'unité.
- Signale les timestamps absents et les incohérences de séquence.
- Toute conclusion globale doit venir d'un agrégat sur la population entière ; garde les constats d'un échantillon explicitement au niveau de cet échantillon.

## Interdits

- N'utilise pas la date courante pour vieillir un corpus historique figé.
- N'explique pas un blocage depuis le seul statut de la commande.
- Ne recommande pas une annulation sans vérifier les dépendances opérationnelles.
- Ne généralise pas un paiement, un avis, un retard ou une cause observés sur quelques commandes à tout le backlog.
- Si `date_calculator` ou Db2 ne peut pas produire la durée, indique qu'elle n'est pas déterminée au lieu de l'estimer.

## Forme de la conclusion

Affiche la date de référence, les deux durées, les éléments de cycle de vie et une recommandation conditionnelle.
