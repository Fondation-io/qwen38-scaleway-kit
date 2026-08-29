---
name: security-signal-analysis
description: Qualifie un signal de sécurité sans transformer tentative, anomalie ou corrélation en compromission prouvée.
workspaces: [security]
---

## Méthode

1. Établis ce que chaque type d'événement prouve réellement.
2. Compare les signaux au comportement habituel du profil et cherche plusieurs sources indépendantes.
3. Évalue les hypothèses concurrentes avant de qualifier le risque.
4. Si la demande exige des fenêtres temporelles, charge aussi `temporal-correlation` avant les requêtes d'analyse.

## Contrôles obligatoires

- Une tentative ou un échec d'authentification ne prouve ni connexion réussie ni compromission.
- Une coïncidence temporelle, un volume cumulé ou un nom technique ne prouve ni causalité, ni service, ni exfiltration.
- Exige un événement positif ou une chaîne de preuves pour déclarer une action réussie.
- Respecte les refus de PII sans rechercher une autre table pour contourner la restriction.
- Pour une corrélation, sélectionne les identifiants techniques, rôles et autorités nécessaires, jamais les noms, e-mails, superviseurs ou contenus en clair.
- Corrèle des sources réseau sur la même adresse IP exacte et une fenêtre compatible, jamais par simple appartenance au même sous-réseau.
- `cert_insiders` est une vérité terrain synthétique réservée au benchmark : ne la requête pas et ne l'utilise jamais comme preuve dans une investigation opérationnelle, sauf demande explicite d'évaluation du banc.
- N'accède à un contenu sensible que s'il est indispensable au verdict demandé et qu'aucun agrégat ne suffit. Après un refus, conclus avec les métadonnées disponibles sans rejouer l'analyse.
- Arrête l'exploration lorsque les preuves suffisent au verdict ; vise six requêtes d'analyse et respecte le plafond serveur absolu.

## Interdits

- Ne présente pas la vérité terrain synthétique comme une preuve de production.
- Ne recommande pas un blocage permanent à partir d'un signal unique non confirmé.
- Ne qualifie pas un profil de bénin ou malveillant sur la seule foi d'un contenu textuel.
- Ne demande pas une approbation de contenu sensible pour enrichir une conclusion déjà établie par des métadonnées.

## Forme de la conclusion

Donne le verdict, le niveau de confiance, les preuves favorables et contraires, puis trois mesures temporaires et réversibles au maximum à soumettre à validation humaine.
