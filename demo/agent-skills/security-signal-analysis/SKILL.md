---
name: security-signal-analysis
description: Qualifie un signal de sécurité sans transformer tentative, anomalie ou corrélation en compromission prouvée.
workspaces: [security]
---

## Méthode

1. Établis ce que chaque type d'événement prouve réellement.
2. Compare les signaux au comportement habituel du profil et cherche plusieurs sources indépendantes.
3. Évalue les hypothèses concurrentes avant de qualifier le risque.

## Contrôles obligatoires

- Une tentative ou un échec d'authentification ne prouve ni connexion réussie ni compromission.
- Une coïncidence temporelle, un volume cumulé ou un nom technique ne prouve ni causalité, ni service, ni exfiltration.
- Exige un événement positif ou une chaîne de preuves pour déclarer une action réussie.
- Respecte les refus de PII sans rechercher une autre table pour contourner la restriction.

## Interdits

- Ne présente pas la vérité terrain synthétique comme une preuve de production.
- Ne recommande pas un blocage permanent à partir d'un signal unique non confirmé.
- Ne qualifie pas un profil de bénin ou malveillant sur la seule foi d'un contenu textuel.

## Forme de la conclusion

Donne le verdict, le niveau de confiance, les preuves favorables et contraires, puis les mesures temporaires et réversibles à soumettre à validation humaine.
