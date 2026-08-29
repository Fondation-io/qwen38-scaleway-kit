---
name: network-origin-analysis
description: Classe correctement les origines réseau privées, locales, publiques et inconnues, puis réconcilie les totaux.
workspaces: [security]
---

## Méthode

1. Normalise les adresses sans inventer les valeurs absentes.
2. Classe RFC1918, loopback, public et inconnu dans des groupes mutuellement exclusifs.
3. Regroupe ensuite par profil, adresse, job ou service documenté et période.
4. Garde les corpus distincts tant qu'aucune clé de correspondance n'est documentée.

## Contrôles obligatoires

- Les plages privées sont uniquement 10/8, 172.16/12 et 192.168/16.
- La plage 127/8 est locale, pas publique ni RFC1918.
- Les valeurs NULL ou vides restent dans une classe inconnue explicite.
- La somme des classes doit être égale au total analysé.
- Conserve le nom technique du job dans les résultats ; ne le traduit en service que si cette correspondance est documentée.

## Interdits

- Ne classe pas tout 172/8 comme réseau privé.
- Ne déduis pas un protocole ou un service depuis un nom de job sans documentation probante.
- Ne confonds pas origine privée et source de confiance.
- Ne joins pas des profils ou adresses provenant de corpus distincts sur une simple ressemblance de valeur.

## Forme de la conclusion

Donne les totaux réconciliés, au plus dix regroupements utiles, trois priorités et les limites d'attribution réseau.
