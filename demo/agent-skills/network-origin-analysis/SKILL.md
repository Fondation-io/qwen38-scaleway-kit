---
name: network-origin-analysis
description: Classe correctement les origines réseau privées, locales, publiques et inconnues, puis réconcilie les totaux.
workspaces: [security]
---

## Méthode

1. Normalise les adresses sans inventer les valeurs absentes.
2. Classe RFC1918, loopback, public et inconnu dans des groupes mutuellement exclusifs.
3. Regroupe ensuite par profil, adresse, job ou service documenté et période.
4. Corrèle deux sources uniquement sur la même adresse IP exacte et une fenêtre temporelle compatible ; garde les corpus distincts sinon.
5. Dans `HONEYPOT.qaudjrn_pw`, si la demande vise les profils qui semblent exister, définis d'abord ce corpus avec `type_violation IS NOT NULL AND type_violation <> 'User name not valid'`, puis analyse seulement ses origines et services.

## Contrôles obligatoires

- Les plages privées sont uniquement 10/8, 172.16/12 et 192.168/16.
- La plage 127/8 est locale, pas publique ni RFC1918.
- Les valeurs NULL ou vides restent dans une classe inconnue explicite.
- La somme des classes doit être égale au total analysé.
- Conserve le nom technique du job dans les résultats ; ne le traduit en service que si cette correspondance est documentée.
- Attribue chaque événement à l'adresse exacte qui le porte : un événement IDS sur une IP ne confirme pas l'activité d'une autre IP du même sous-réseau.
- Le filtre `type_violation <> 'User name not valid'` est un signal du journal qu'un profil semble exister, pas une preuve d'annuaire : conserve cette nuance dans le verdict.

## Interdits

- Ne classe pas tout 172/8 comme réseau privé.
- Ne déduis pas un protocole ou un service depuis un nom de job sans documentation probante.
- Ne confonds pas origine privée et source de confiance.
- Ne joins pas des profils ou adresses provenant de corpus distincts sur une simple ressemblance de valeur.
- Ne présente jamais la proximité d'adresses ou un sous-réseau commun comme la preuve d'un même opérateur ; qualifie-la seulement d'hypothèse à vérifier.
- N'infère jamais l'existence d'un profil depuis l'apparence, la plausibilité ou l'orthographe de `user_name`.

## Forme de la conclusion

Donne les totaux réconciliés, au plus dix regroupements utiles, trois priorités et les limites d'attribution réseau.
