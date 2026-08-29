---
name: business-metrics
description: Définit le grain et les métriques métier, évite les doubles comptages et vérifie les calculs.
workspaces: [gestion]
---

## Méthode

1. Définis le grain de chaque table et l'entité métier mesurée : commande, ligne, paiement, client ou catégorie.
2. Définis les composantes du montant et les statuts inclus avant de calculer.
3. Agrège chaque relation au bon grain avant les jointures susceptibles de multiplier les lignes.

## Contrôles obligatoires

- Un panier par commande utilise des commandes distinctes, pas le nombre de lignes.
- Précise si le chiffre d'affaires inclut prix, fret, annulations ou remboursements.
- Calcule les ratios, évolutions et nombres de transitions depuis les agrégats retournés.
- Conserve les catégories NULL ou non traduites dans un groupe explicite.
- Une concaténation avec NULL reste NULL : distingue explicitement « non renseigné » de « non traduit » avant l'agrégation.

## Interdits

- Ne nomme pas panier moyen un montant divisé par des lignes de commande.
- Ne joins pas directement lignes et paiements sans prévenir la multiplication des montants.
- Ne transforme pas une saisonnalité observée en explication commerciale prouvée.

## Forme de la conclusion

Commence par les définitions, donne les chiffres contrôlés, puis sépare observations et hypothèses métier.
