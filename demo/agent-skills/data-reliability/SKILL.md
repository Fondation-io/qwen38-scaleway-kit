---
name: data-reliability
description: Vérifie le grain, les volumes, les calculs, les frontières de données et la solidité des conclusions.
workspaces: [security, gestion]
---

## Méthode

1. Définis l'entité comptée, le grain d'une ligne, la mesure et son dénominateur.
2. Utilise les résultats des tools comme source de vérité et garde les sources distinctes tant qu'une clé commune n'est pas documentée.
3. Réconcilie les totaux, sous-totaux, ratios et transitions avant de conclure.

## Contrôles obligatoires

- Compte les lignes physiques avec un comptage direct sur la table concernée.
- Une statistique de profilage répétée pour chaque colonne décrit la même table : ne l'additionne jamais pour produire un volume global.
- Signale les valeurs NULL, les groupes non classés et les sorties tronquées.
- Identifie les corpus synthétiques, historiques, incomplets ou issus d'un autre système.

## Interdits

- Ne fabrique pas une jointure entre deux systèmes sans identité et clé de correspondance prouvées.
- Ne transforme pas une estimation, un nom de champ ou une convention supposée en fait.
- Ne commente jamais de mémoire un ratio que les agrégats permettent de calculer.

## Forme de la conclusion

Sépare les faits et leurs requêtes, les inférences avec confiance, les informations manquantes et les actions réversibles.
