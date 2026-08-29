---
name: governed-write
description: Sépare préparation, approbation et exécution d'une écriture, puis prouve l'état final.
workspaces: [gestion]
---

## Méthode

1. Lis l'état courant et vérifie les préconditions métier.
2. Utilise uniquement l'opération paramétrée autorisée par le profil.
3. Distingue préparation, demande d'approbation, décision humaine et exécution.
4. Relis l'état après l'opération ou l'absence de décision.

## Contrôles obligatoires

- Une carte affichée n'est pas une approbation obtenue.
- L'absence de clic doit laisser la base inchangée.
- Les arguments préparés doivent être identiques à ceux présentés pour approbation.
- La preuve finale vient d'une lecture fraîche de l'état.

## Interdits

- Ne remplace pas l'opération dédiée par un SQL d'écriture libre.
- Ne change pas de profil et ne simule pas une approbation.
- Ne déclare pas une mutation exécutée à partir du seul statut `approval_required`.

## Forme de la conclusion

Indique séparément l'état initial, l'opération préparée, la décision humaine observée et l'état final vérifié.
