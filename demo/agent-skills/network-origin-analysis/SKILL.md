---
name: network-origin-analysis
description: Classe correctement les origines réseau privées, locales, publiques et inconnues, puis réconcilie les totaux.
workspaces: [security]
---

## Méthode

1. Normalise les adresses sans inventer les valeurs absentes.
2. Classe RFC1918, loopback, public et inconnu dans des groupes mutuellement exclusifs.
3. Regroupe ensuite par profil, adresse, job ou service documenté et période.

## Contrôles obligatoires

- Les plages privées sont uniquement 10/8, 172.16/12 et 192.168/16.
- La plage 127/8 est locale, pas publique ni RFC1918.
- Les valeurs NULL ou vides restent dans une classe inconnue explicite.
- La somme des classes doit être égale au total analysé.

## Interdits

- Ne classe pas tout 172/8 comme réseau privé.
- Ne déduis pas un protocole ou un service depuis un nom de job sans documentation probante.
- Ne confonds pas origine privée et source de confiance.

## Forme de la conclusion

Donne les totaux réconciliés, les regroupements prioritaires et les limites d'attribution réseau.
