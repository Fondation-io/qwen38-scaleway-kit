---
name: temporal-correlation
description: Construit des fenêtres temporelles exactes et distingue corrélation, ordre des événements et causalité.
workspaces: [security]
---

## Méthode

1. Convertis le timestamp complet dans le dialecte disponible.
2. Fais construire la borne inférieure et la borne supérieure autour de l'événement pivot par le moteur SQL ou par `date_calculator`.
3. Compare la fenêtre, la journée entière et la baseline lorsque ces niveaux existent.
4. Pour chaque flux rare, compte aussi ses jours actifs sur toute la période (`COUNT(*)`, `MIN(day)`, `MAX(day)` groupés par profil et stream) avant de qualifier le jour pivot.

## Contrôles obligatoires

- Gère les changements de jour, de mois et d'année.
- Distingue les événements antérieurs, simultanés et postérieurs.
- Vérifie les unités et la durée réelle de la fenêtre.
- Ne fais aucun calcul mental de date, de durée ou de décalage : recopie exactement le résultat SQL ou `date_calculator` et mentionne l'unité.
- Signale les timestamps invalides ou lexicographiquement ambigus.
- Sur un timestamp texte non ISO, convertis avant le tri et les agrégats : un MIN/MAX lexicographique ne donne pas la première ou la dernière date.
- `SECAUDIT.DAILY_BASELINE` ne contient une ligne que pour un jour où le flux est actif. Sa moyenne et son écart-type décrivent les jours actifs, pas la fréquence calendaire du flux.
- Un écart-type nul avec un seul jour actif ne signifie jamais « activité normale » : si ce jour unique coïncide avec l'événement pivot, signale une corrélation rare sans en déduire la causalité.

## Interdits

- N'utilise pas la seule composante heure pour simuler une distance temporelle.
- Ne transforme pas une proximité temporelle en causalité.
- Ne masque pas l'absence d'événement dans une des sources demandées.
- Ne conclus pas qu'un flux est normal depuis `mean_events` et `std_events` sans avoir vérifié le nombre de jours actifs.
- Si le moteur SQL et `date_calculator` refusent un timestamp, signale l'ambiguïté au lieu d'estimer la fenêtre.

## Forme de la conclusion

Présente une chronologie courte, qualifie chaque relation comme antérieure, corrélée ou causalement prouvée, puis liste la preuve manquante.
