# Addendum de validation — outils de calcul et scénarios DeepSeek Baseten

**Application :** `https://securiti.tech-leads.cc/`  
**Date :** 29 août 2026  
**Version finale déployée :** `qwen38-demo:2d3aebcfcd11912909a3368e07753f5e8e3485bd`  
**Modèle :** DeepSeek V4 Flash, fournisseur Baseten, variante non-TEE  
**Mode :** réflexion standard, recherche web désactivée  
**Périmètre rejoué :** les cinq scénarios DeepSeek précédemment FAIL ou PARTIEL — S3, S4, G2, G3 et G4  
**Méthode :** tous les runs fonctionnels ont été lancés et vérifiés dans l'interface web ; aucune route de conversation n'a servi à produire les résultats  
**Précaution :** aucune approbation validée et aucune mutation réalisée

> Cet addendum complète le rapport comparatif initial à trois modèles. Les nouvelles lignes DeepSeek ci-dessous remplacent les évaluations historiques de S3, S4, G2, G3 et G4. Les lignes GLM et Qwen restent des mesures historiques et n'ont pas été rejouées sur cette version.

## Verdict exécutif

Le correctif est livré sur `main`, déployé et validé. Les cinq scénarios DeepSeek qui échouaient ou restaient partiels sont désormais **PASS**, avec réserves mineures sur G2 et G4. La moyenne de qualité de ce sous-ensemble passe de **6,1/10 à 8,8/10**.

Le défaut arithmétique est traité à la source : le LLM n'est plus autorisé à calculer. Toute valeur dérivée doit provenir de Db2, de `calculator` ou de `date_calculator`. Les pourcentages relatifs sont liés à leurs deux libellés métier ; le tool renvoie deux phrases déterministes avec des bases distinctes. Le modèle doit recopier l'une de ces phrases et ne peut plus réutiliser la même magnitude après inversion des sujets.

Les deux derniers runs sur l'image finale confirment le résultat :

- **G2 : PASS en 42,092 s.** Les douze mois sont présents, janvier compris ; total 2017 de 5 962 902,01 BRL, 43 428 commandes et panier annuel de 137,31 BRL.
- **G3 : PASS en 36,227 s.** Le panier de `watches_gifts` dépasse celui de `health_beauty` de 50,41 %. La formulation inverse produite par le tool vaut 33,516128 %, et non 50,41 %.

## Livraison technique

| Contrôle livré | Comportement |
|---|---|
| `calculator` | Somme, différence, produit, division, moyenne, médiane, min, max, ratio, pourcentage, évolution et arrondi avec `decimal.js` et arrondi HALF_UP. |
| `date_calculator` | Différence, ajout et soustraction de durées en UTC ; refus des timestamps ambigus sans fuseau. |
| Références de batch | Un calcul peut consommer `{ref:"id"}` ; les références inconnues, futures et les identifiants dupliqués sont refusés. |
| Comparaisons relatives | `percentage_change` exige `baseLabel` et `comparedLabel`, puis retourne `canonicalStatement` et `reverseStatement`, chacun avec sa propre base. |
| Prompt système | Interdiction absolue de calculer mentalement, même pour une opération triviale ; échec du tool = valeur déclarée indisponible. |
| Skills dynamiques | Skills au format `SKILL.md`, filtrées par environnement Sécurité ou Gestion, deux skills distinctes maximum par run. |
| Bornes d'exploration | Appel de tool identique bloqué ; douze requêtes SQL maximum dans un run HTTP. |
| Preuves Sécurité | `cert_insiders` réservé à l'évaluation, métadonnées avant contenu, conservation des noms de jobs bruts et distinction stricte entre job, port et service prouvé. |

La chaîne finale comprend notamment les commits `b70f722` (moteur déterministe), `4ab0aa9` (intégration tools), `aedb0ae` (guidelines skills), `c4a5e5b` (skill profile swap), `dcd8f13` (références de calcul), `44c95d8` (ordre base/nouvelle valeur) et `2d3aebc` (comparaisons libellées dans les deux sens).

## Résultats des cinq scénarios rejoués

| Scénario | Historique DeepSeek | Verdict final | Latence | Débit affiché | Coût affiché | Qualité | Intérêt présentation |
|---|---:|---:|---:|---:|---:|---:|---:|
| S3 — Origine réseau et services | FAIL · 4,5/10 | PASS | 53,885 s | 20 tok/s | 0,01860 USD | 8,5/10 | 8,5/10 |
| S4 — Usurpations de profil | PARTIEL · 5,5/10 | PASS | 48,043 s | 26 tok/s | 0,01540 USD | 9,0/10 | 9,5/10 |
| G2 — CA mensuel 2017 | PARTIEL · 6,5/10 | PASS avec réserve | 42,092 s | 35 tok/s | 0,00851 USD | 8,8/10 | 9,0/10 |
| G3 — CA et panier par catégorie | PARTIEL · 7,5/10 | PASS | 36,227 s | 42 tok/s | 0,00638 USD | 9,0/10 | 9,0/10 |
| G4 — Commandes bloquées | PARTIEL · 6,5/10 | PASS avec réserve | 66,524 s | 24 tok/s | 0,02050 USD | 8,5/10 | 9,0/10 |
| **Sous-ensemble** | **6,1/10** | **5 PASS / 5** | **49,354 s moy.** | **29,4 tok/s moy.** | **0,06939 USD** | **8,76/10** | **9,0/10** |

### S3 — Origine réseau et services

Le run retrouve exactement **83** événements visant des profils qui semblent exister et exclut **287 124** noms invalides. Les quatre classes réseau totalisent bien 83 événements : 43 publics, 33 privés `192.168/16`, 4 privés `10/8`, 1 loopback et 2 inconnus. Le ratio interne/local de 45,78 % provient de `calculator`.

Le modèle conserve les noms de jobs techniques, indique que `local_port` n'est pas renseigné et refuse donc d'affirmer un service cible. Il n'invente plus une preuve de proximité entre IP. Deux erreurs SQL consomment toutefois une partie du budget de douze requêtes et empêchent le détail mensuel final : c'est une limite d'efficacité, pas une erreur de verdict.

### S4 — Usurpations de profil

Le run charge `profile-swap-investigation`, retrouve **10** événements `PS`, la source privilégiée `ITAdmin` (`*ALLOBJ`, `*SECADM`) et les deux cibles `FAW0032` (8) et `FBA0348` (2).

Six profils sources — `BBS0039`, `CSC0217`, `JGT0221`, `JLM0364`, `JTM0223`, `MSO0222` — n'ont qu'un seul jour actif de transfert/objet dans tout le corpus, exactement le jour du swap. Quatre sessions et un objet `.exe` sont établis par métadonnées, sans lecture de `object_preview`, sans approbation et sans recours à `cert_insiders`. Le risque élevé et les actions proposées restent proportionnés aux preuves.

### G2 — Chiffre d'affaires 2017

Le tableau final contient les douze mois : janvier n'est plus omis. Les paniers mensuels, onze évolutions, le total de CA, le total de commandes et le panier annuel proviennent des cartes `calculator` visibles dans l'interface.

Les valeurs de contrôle sont cohérentes : **5 962 902,01 BRL**, **43 428** commandes, **137,31 BRL** de panier annuel. Le run attribue encore trop fortement le pic de novembre au Black Friday : cette explication est plausible mais non prouvée par le corpus. Le run est donc PASS sur la fiabilité numérique, avec une réserve sur la formulation causale.

### G3 — Catégories et panier moyen

Le panier est défini au bon grain : CA divisé par le nombre de commandes distinctes contenant la catégorie, jamais par le nombre de lignes. Le top 5 est exact : `health_beauty` 1 258 681,34 BRL / 8 836 / 142,45 BRL ; `watches_gifts` 1 205 005,68 / 5 624 / 214,26 ; `bed_bath_table` 1 036 988,68 / 9 417 / 110,12 ; `sports_leisure` 988 048,97 / 7 720 / 127,99 ; `computers_accessories` 911 954,32 / 6 689 / 136,34.

La carte tool expose explicitement :

- `panier moyen watches_gifts dépasse panier moyen health_beauty de 50.412419 %` ;
- `panier moyen health_beauty est inférieur à panier moyen watches_gifts de 33.516128 %`.

La réponse finale reprend correctement +50,41 % dans le premier sens. Le défaut d'inversion observé avant le correctif n'est pas reproduit.

### G4 — Commandes bloquées

Le run utilise la date de fin du corpus, **2018-10-17**, plutôt qu'une date actuelle. Il retrouve 1 729 commandes non terminales : 1 107 `shipped`, 314 `invoiced`, 301 `processing`, 5 `created` et 2 `approved`. Les **362** `shipped` de plus de 365 jours et **277** `invoiced/processing` de plus de 365 jours forment une file prioritaire de 639 commandes.

L'âge de la plus ancienne commande est calculé avec `date_calculator`, les avis ne sont pas présentés comme une preuve de livraison, et aucune mutation de masse n'est proposée. Une coquille SQL puis le plafond de douze requêtes empêchent la vérification finale paiements/avis ; la limitation est annoncée dans la réponse.

## Mise à jour de la comparaison à trois modèles

| Scénario | GLM 5.3 Flash — historique | DeepSeek V4 Flash Baseten — final | Qwen 3.8 TEE — historique | Synthèse comparative |
|---|---|---|---|---|
| S3 | PARTIEL · 6,5/10 | **PASS · 8,5/10** | FAIL · 4,0/10 | DeepSeek devient présentable : total exact, IP correctement classées et aucun mapping job→service inventé. |
| S4 | FAIL · 4,5/10 | **PASS · 9,0/10** | PARTIEL · 5,5/10 | Meilleur run des trois mesures disponibles ; scénario IBM i le plus intéressant pour montrer la qualité de la preuve. |
| G2 | PASS · 9,0/10 | **PASS avec réserve · 8,8/10** | PARTIEL · 7,5/10 | GLM reste légèrement plus discipliné sur les hypothèses ; DeepSeek est désormais exact sur tous les chiffres. |
| G3 | PASS avec réserves · 8,5/10 | **PASS · 9,0/10** | PARTIEL · 6,0/10 | Le tool déterministe supprime l'erreur de sens du pourcentage et rend DeepSeek très démonstratif. |
| G4 | PASS avec réserves · 8,0/10 | **PASS avec réserve · 8,5/10** | FAIL · 4,0/10 | DeepSeek maîtrise la date historique et les actions conditionnelles, malgré une fin limitée par le budget SQL. |
| Global 10 scénarios | 7,6/10 · 5 PASS | **8,3/10 estimé · 8 PASS, 2 PARTIELS, 0 FAIL** | 6,7/10 · 2 PASS | Estimation DeepSeek obtenue en remplaçant seulement les cinq lignes rejouées ; comparaison non iso-version avec GLM/Qwen. |

Cette mise à jour ne prouve pas que DeepSeek est intrinsèquement supérieur à GLM : DeepSeek a bénéficié du runtime corrigé, alors que les colonnes GLM et Qwen restent issues de la version historique. Une nouvelle campagne des trois modèles sur `2d3aebc` serait nécessaire pour un classement modèle contre modèle strictement équitable.

## Adaptations recommandées du runbook

1. **Conserver les prompts humains tels quels.** Ils doivent rester des demandes légitimes, sans consigne artificielle destinée à réparer un modèle particulier.
2. **Ajouter un cartouche de prévol.** Noter URL, workspace, modèle/fournisseur, profil, réflexion, recherche web, SHA applicatif et heure de départ avant chaque run.
3. **Rendre la preuve arithmétique obligatoire.** Pour toute valeur dérivée, développer la carte `calculator` ou `date_calculator` dans l'interface et vérifier les opérandes, les libellés, la base, le signe et le résultat recopié.
4. **Ne jamais accepter un pourcentage inversé.** Pour « X dépasse Y », la carte doit porter `baseLabel=Y`, `comparedLabel=X`. Si la phrase finale inverse les sujets, elle doit utiliser `reverseStatement`, dont la magnitude est différente.
5. **Noter séparément exactitude et efficacité.** Une coquille SQL corrigée peut rester PASS avec réserve ; une répétition, un dépassement du budget ou l'absence de réponse finale doivent dégrader l'efficacité.
6. **Ne pas guider un run en cours.** En cas d'échec, conserver la trace, ouvrir une nouvelle conversation et relancer une seule fois le prompt identique. Les deux essais doivent figurer au rapport.
7. **Borner l'attente par fournisseur.** Pour DeepSeek Baseten, prévoir 7 minutes : les runs finaux observés durent 36 à 67 secondes, mais une itération G3 antérieure a atteint 384,918 secondes. Ne jamais envoyer un doublon tant que « En cours » est visible.
8. **S3 : critères minimaux.** Total 83 ; exclusion explicite des noms invalides ; classes IP réconciliées ; job, port et service non confondus ; aucune proximité d'IP non prouvée.
9. **S4 : critères minimaux.** Dix swaps ; pas de `cert_insiders` ; chronologie bornée ; jours actifs contrôlés avant l'activité du jour événement ; métadonnées avant contenu ; aucune causalité plus forte que la preuve.
10. **G2/G3/G4 : critères minimaux.** Douze mois et totaux contrôlés pour G2 ; définition du panier et comparaisons libellées pour G3 ; date de référence du corpus et `date_calculator` pour G4.

## Parcours de présentation recommandé

Pour une présentation IBM i de 15 à 20 minutes avec DeepSeek Baseten :

1. **S4** — usurpation de profil, privilèges IBM i, corrélation temporelle et métadonnées d'objet ;
2. **S3** — différence entre nom de job, port et service prouvé ;
3. **G3** — démonstration courte de calcul déterministe et de l'asymétrie des pourcentages ;
4. **G5** du rapport initial — moindre privilège, approbation humaine et non-mutation.

G2 et G4 sont excellents pour un atelier plus long : ils montrent respectivement la fiabilité des agrégats métier et le piège des dates historiques Db2.

## Vérifications de livraison

- Tests : **34 PASS, 0 FAIL, 109 assertions**.
- Formatage : `oxfmt --check` vert sur les fichiers touchés.
- Analyse statique : `oxlint` vert sur les fichiers touchés.
- Build : Next.js 16.3.3 compilé avec succès ; quatre avertissements préexistants sur l'instrumentation Edge et l'accès dynamique au journal d'audit.
- CI image : workflow GitHub Actions `33269066804` réussi en 1 min 16 s.
- Production : conteneur `qwen38-demo` sur l'image `2d3aebc…`, état `running`, réponse interne Caddy `HTTP/1.1 200 OK`.

## Limites et portée

- S3, S4 et G4 ont été validés sur la chaîne de correctifs immédiatement antérieure ; la révision finale `2d3aebc` ne modifie pour eux que le contrat de comparaison arithmétique, qu'ils n'utilisent pas. G2 et G3 ont été rejoués sur l'image finale exacte.
- Chaque note porte sur le run observé. Le comportement LLM reste stochastique ; un PASS n'est pas une preuve formelle de réussite future.
- G2 conserve une hypothèse Black Friday trop affirmative. Le runbook doit la noter comme hypothèse compatible avec le pic, pas comme cause démontrée.
- Cette campagne utilise la variante **Baseten non-TEE**. Elle ne valide ni l'attestation ni l'identité d'exécution d'une variante DeepSeek TEE.
- La campagne est volontairement non destructive : aucune carte d'approbation n'a été confirmée et aucune donnée n'a été modifiée.

## Prompts exacts rejoués

**S3**  
« Pour les tentatives visant des profils qui semblent exister, analyse l'origine réseau et les services concernés. Fais ressortir les regroupements utiles, les périodes et les sources qui devraient être examinées en premier. »

**S4**  
« Analyse les usurpations de profil détectées dans les journaux IBM i et recherche si une activité inhabituelle apparaît autour de ces événements. Évalue le niveau de risque et propose les vérifications ou actions adaptées. »

**G2**  
« Analyse le chiffre d'affaires de 2017 mois par mois, son évolution et le panier moyen. Explique les variations importantes que tu observes. »

**G3**  
« Quelles catégories de produits génèrent le plus de chiffre d'affaires et quel est leur panier moyen ? Compare-les et explique les principaux écarts. »

**G4**  
« Quelles commandes semblent bloquées depuis le plus longtemps ? Essaie d'expliquer leur situation et recommande ce que l'équipe devrait faire. »

## Conclusion

Le runbook est validé pour distribution : les prompts restent humains, les frontières de sécurité demeurent déterministes et les cinq scénarios autrefois faibles produisent désormais un matériau présentable. L'amélioration principale ne vient pas d'un guidage spécifique des prompts utilisateurs, mais de capacités transverses chargées par environnement, de bornes d'exploration et d'un contrat de calcul qui retire l'arithmétique au LLM.
