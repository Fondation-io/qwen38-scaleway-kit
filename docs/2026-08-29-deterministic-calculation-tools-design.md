# Outils de calcul déterministe pour le lab IBM i

## Objectif

Interdire aux modèles du lab de produire eux-mêmes une valeur numérique dérivée. Une somme, différence, multiplication, division, moyenne, médiane, ratio, pourcentage, évolution, arrondi, conversion de durée ou opération de date doit être exécutée par un outil déterministe ou directement par Db2. Le modèle peut uniquement recopier sans modification une valeur fournie par l'utilisateur ou retournée par un outil.

La modification concerne le runtime conversationnel `demo`. Elle ne crée pas une row Agent Forge et ne change ni les profils, ni les gates SQL, ni les règles d'approbation.

## Approches considérées

### 1. Évaluateur d'expressions libres

Un tool accepterait une chaîne telle que `(a + b) / c * 100`. L'interface serait compacte, mais elle imposerait un parseur d'expressions, offrirait une surface plus large que nécessaire et rendrait l'audit moins lisible.

### 2. Opérations typées batchées — retenue

Deux tools acceptent des listes d'opérations structurées : un pour l'arithmétique, un pour les dates. Chaque résultat porte un identifiant fourni par le modèle. Cette forme est explicite, auditable, validée par Zod et permet de vérifier plusieurs mois ou ratios en un seul appel.

### 3. Calcul exclusivement en SQL

Db2 sait calculer les agrégats et les durées, mais cette solution ne couvre ni les valeurs issues de plusieurs requêtes, ni les demandes générales sans base, ni les contrôles croisés. Elle reste autorisée comme source déterministe, sans constituer l'unique calculateur.

## Architecture

### Module pur

Créer `demo/lib/deterministic-calculation.ts`. Il contient :

- les schémas Zod des deux tools ;
- les fonctions pures de calcul batché ;
- les factories de tools enveloppées par l'audit existant dans `tools.ts` ;
- le protocole système commun `DETERMINISTIC_CALCULATION_PROTOCOL`.

Les décimaux transitent sous forme de chaînes afin d'éviter l'arrondi binaire de JSON/JavaScript. Les opérations utilisent `decimal.js`, sans `eval` ni exécution de texte arbitraire.

### Tool `calculator`

Entrée :

```json
{
  "calculations": [
    {
      "id": "ca_2017",
      "operation": "sum",
      "values": ["127482.37", "271239.32"],
      "scale": 2
    }
  ]
}
```

Opérations autorisées :

- `sum`, `subtract`, `multiply`, `divide` ;
- `average`, `median`, `min`, `max` ;
- `ratio`, `percent_of`, `percentage_change` ;
- `round`.

Une requête contient de 1 à 100 calculs et chaque calcul de 1 à 200 valeurs selon l'opération. `scale` est compris entre 0 et 12 ; le mode d'arrondi est `half_up`. Les divisions par zéro, listes vides, arités invalides, valeurs non finies ou chaînes décimales invalides sont refusées.

Sortie :

```json
{
  "source": "calculator",
  "results": [
    {
      "id": "ca_2017",
      "operation": "sum",
      "value": "398721.69",
      "scale": 2
    }
  ]
}
```

### Tool `date_calculator`

Opérations autorisées :

- `difference` entre deux dates ou timestamps, en secondes, minutes, heures ou jours ;
- `add` et `subtract` d'une durée exprimée en secondes, minutes, heures, jours ou semaines.

Les dates simples `YYYY-MM-DD` sont interprétées à minuit UTC. Un timestamp doit être ISO 8601 et inclure `Z` ou un décalage explicite. Les mois et années ne sont pas proposés, car leur durée est contextuelle. La sortie d'une différence est une chaîne décimale ; la sortie d'un décalage est un timestamp ISO UTC.

## Règle système

Le protocole est injecté dans les prompts système Sécurité et Gestion :

1. le modèle n'effectue jamais de calcul mental, implicite ou dans son raisonnement ;
2. toute valeur dérivée vient de `calculator`, `date_calculator` ou d'un calcul inclus dans un résultat Db2 ;
3. le modèle peut recopier une valeur source sans la modifier ;
4. additionner des lignes, calculer un pourcentage, arrondir ou convertir une durée exige un tool même si l'opération paraît triviale ;
5. si le tool refuse ou échoue, le modèle signale l'impossibilité et ne calcule pas lui-même ;
6. avant la réponse finale, chaque valeur dérivée doit être reliée à son résultat de tool.

La description de chaque tool rappelle qu'il est obligatoire. Les tools sont toujours exposés dans les deux workspaces, indépendamment de la recherche web et du profil.

## Skills

`data-reliability`, `business-metrics`, `historical-backlog` et `temporal-correlation` sont durcies :

- aucune vérification arithmétique « de mémoire » ;
- les réconciliations multi-lignes passent par `calculator` ;
- les durées passent par Db2 ou `date_calculator` ;
- les valeurs retournées sont reprises exactement, avec leur unité et leur précision.

Les prompts utilisateurs du runbook restent naturels et inchangés.

## Erreurs et audit

Les tools utilisent l'enveloppe `traced` existante. Chaque batch produit un `tool_call`, un `tool_result` ou un `tool_error`. Les arguments et la durée sont donc auditables. Une erreur de calcul ne casse pas le stream : le tool retourne l'enveloppe d'erreur existante et le prompt interdit tout repli mental.

Cette première version impose la règle par le contrat de tool, le prompt système, les skills et la recette comportementale. Elle ne bloque pas le stream après génération sur la base d'une analyse heuristique des nombres : une telle gate créerait de nombreux faux positifs sur les identifiants, dates, ports et nombres directement copiés des tools.

## Tests hors ligne

Le cycle TDD couvre :

1. somme exacte des douze CA mensuels du scénario G2 : `6921535.24` ;
2. total exact des douze nombres de commandes : `43428` ;
3. pourcentage, évolution, moyenne, médiane et arrondi ;
4. multiplication et division, dont division par zéro ;
5. différence historique de 773 jours et décalages de date ;
6. rejet des timestamps ambigus et des unités non prises en charge ;
7. exposition de `calculator` et `date_calculator` dans les deux workspaces ;
8. présence de l'interdiction absolue dans le protocole système et dans les skills concernées.

Le lint et le build Next.js doivent ensuite être verts.

## Recette Baseten ciblée

Après déploiement de la branche candidate, rejouer dans l'interface web avec DeepSeek V4 Flash Baseten, réflexion standard et recherche web coupée :

- S3 : réconciliation des classes et absence de calcul mental ;
- S4 : fenêtres et durées calculées par tool, sans vérité terrain comme preuve ;
- G2 : douze mois, total `6921535.24` et 43 428 commandes via `calculator` ;
- G3 : ratios/paniers issus du tool et aucune marge inventée ;
- G4 : durées Db2 ou `date_calculator`, cardinalités et totaux vérifiés.

Une conversation neuve est utilisée par scénario. Aucune carte d'approbation n'est validée. Le rapport relève les tools appelés, les valeurs exactes, les temps et les verdicts.

## Limites

- Un prompt ne constitue pas une preuve formelle que le modèle n'a jamais effectué une opération interne invisible ; la preuve observable est que toute valeur dérivée publiée est reliée à un tool.
- Les conversions monétaires nécessitant un taux externe restent hors périmètre ; le tool peut appliquer un taux déjà fourni par une source autorisée.
- Les mois et années calendaires ne sont pas acceptés comme durées fixes.
