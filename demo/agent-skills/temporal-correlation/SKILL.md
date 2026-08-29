---
name: temporal-correlation
description: Construit des fenêtres temporelles exactes et distingue corrélation, ordre des événements et causalité.
workspaces: [security]
---

## Méthode

1. Convertis le timestamp complet dans le dialecte disponible.
2. Construis une borne inférieure et une borne supérieure autour de l'événement pivot.
3. Compare la fenêtre, la journée entière et la baseline lorsque ces niveaux existent.

## Contrôles obligatoires

- Gère les changements de jour, de mois et d'année.
- Distingue les événements antérieurs, simultanés et postérieurs.
- Vérifie les unités et la durée réelle de la fenêtre.
- Signale les timestamps invalides ou lexicographiquement ambigus.
- Sur un timestamp texte non ISO, convertis avant le tri et les agrégats : un MIN/MAX lexicographique ne donne pas la première ou la dernière date.

## Interdits

- N'utilise pas la seule composante heure pour simuler une distance temporelle.
- Ne transforme pas une proximité temporelle en causalité.
- Ne masque pas l'absence d'événement dans une des sources demandées.

## Forme de la conclusion

Présente une chronologie courte, qualifie chaque relation comme antérieure, corrélée ou causalement prouvée, puis liste la preuve manquante.
