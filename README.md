# qwen38-scaleway-kit

Déploiement, optimisation et recette automatisée de **Qwen3.8-27B-FP8**
servi par vLLM sur une instance Scaleway **L4-2-24G** (2× NVIDIA L4,
48 GB VRAM, ~€1.575/h), plus un **lab** : une application de démonstration
qui interroge une base d'évènements de sécurité via un chatbot outillé.

Config validée en conditions réelles le 2026-08-25 : 25-32 tok/s
mono-requête (décodage spéculatif MTP), ~157 tok/s agrégés, function
calling, multimodal image, contexte 32k.

## Contenu

| Fichier | Usage |
|---------|-------|
| `docs/runbook.md` | Procédure détaillée pour un opérateur humain (phases 0-6, pièges vérifiés) |
| `docs/agent-playbook.md` | Procédure exécutable par un agent (Claude) : 7 étapes, sorties attendues, branches d'échec |
| `scripts/qwen38-recette.sh` | Recette automatisée V2 + T1-T5, rapport markdown dans `artifacts/`, exit 0 si tout passe |
| `scripts/deploy-demo.sh` | Déploiement de la démo chatbot sur l'instance (image GHCR + base rsync) |
| `.env.example` | Template des secrets Scaleway à copier vers `.env` (gitignored) |
| `lab/` | Études, base de données et outillage de la démo (ci-dessous) |
| `demo/` | Application chatbot (Next.js + assistant-ui), voir `demo/README.md` |

## Démarrage rapide

```bash
cp .env.example .env      # remplir avec vos clés Scaleway
set -a; source .env; set +a
# puis suivre docs/runbook.md (humain) ou docs/agent-playbook.md (agent)
# une fois l'instance déployée :
scripts/qwen38-recette.sh <ip-instance>
```

## Le lab : enquête de sécurité assistée par LLM

Le lab démontre un cas d'usage concret du modèle déployé : un chatbot
d'investigation qui répond en langage naturel sur une base d'évènements
de sécurité, en générant du SQL et des graphiques.

### D'où viennent les données

Deux datasets publics Kaggle, ingérés dans une SQLite unique
(~7,5 Go, 20M de lignes) par `lab/scripts/build_db.py` :

- **[CERT Insider Threat r4.2](https://www.kaggle.com/datasets/andrihjonior/cert-insider-threat-dataset-r4-2)**
  (CMU) — 18 mois d'activité synthétique haute-fidélité d'une
  organisation de 1 000 employés : connexions, branchements USB, emails,
  fichiers, navigation web, annuaire LDAP. 70 insiders y déroulent
  5 scénarios d'intrusion documentés (exfiltration, vol par clé USB
  avant départ, keylogger d'un admin, fouille de postes, upload
  Dropbox), avec vérité terrain : utilisateurs et fenêtres temporelles
  exactes. C'est le cœur de la démo "enquête".
- **[Microsoft GUIDE](https://www.kaggle.com/datasets/Microsoft/microsoft-security-incident-prediction)** —
  13,7M d'évidences de télémétrie réelle anonymisée : 1M d'incidents
  SOC, verdicts d'analystes (vrai/faux positif), 441 techniques MITRE
  ATT&CK. Sert l'angle "métriques SOC".

Détail des choix, du profiling et des mesures :
`lab/research/2026-08-25-dataset-study.md`. Le pipeline précalcule
aussi des baselines par utilisateur (détection d'anomalies en SQL
instantané) et le profil statistique des 94 colonnes.

### Transposition IBM i — NON implémentée à ce stade

Aucun dataset public d'évènements IBM i (journal d'audit QAUDJRN)
n'existe ; les données ci-dessus sont servies dans leur vocabulaire
d'origine, sans traduction. La cible visée pour une démo face à un
client IBM i est de rejouer les scénarios d'intrusion du CERT dans le
format QAUDJRN, dont la structure est documentée publiquement (Fortra,
parser Google SecOps, guide 400school — références dans l'étude).
Correspondance proposée, à valider avec un expert IBM i :

| Flux CERT | Types d'entrées QAUDJRN visés |
|-----------|-------------------------------|
| cert_logon (connexions, échecs) | PW (mot de passe/utilisateur invalide), entrées de session QHST |
| cert_file (accès fichiers) | ZR / ZC (lecture / modification d'objet), AF (échec d'autorité) |
| cert_device (supports amovibles) | pas d'équivalent direct — à modéliser en accès objet + description de poste (DV) |
| changements de droits des scénarios | CP (profil utilisateur), CA (autorité), OW (propriétaire), SV (valeur système) |
| cert_http / cert_email | hors périmètre QAUDJRN (télémétrie réseau/messagerie, autre source sur IBM i) |

Tant que cette transposition n'est pas faite, la démo prouve la
mécanique (NL→SQL, outils graphiques, détection d'anomalies avec vérité
terrain) sur des évènements génériques d'entreprise, pas le vocabulaire
IBM i.

### Ce qu'on peut lui demander

Le chatbot dispose de 6 outils : SQL en lecture seule, description des
données, et 4 générateurs de graphiques paramétrés. Exemples :

- **Nature des données** — "Décris les données disponibles", "Quelles
  colonnes dans cert_email ?"
- **Métriques ad hoc (SQL)** — "Combien de connexions entre 22h et 6h
  en octobre 2010 ?", "Top 10 des utilisateurs par volume d'emails",
  "Combien d'incidents d'exfiltration en vrai positif dans GUIDE ?"
- **Enquête sur un utilisateur (graphiques)** — "Montre l'activité USB
  de AAM0658 en octobre-novembre 2010", "Chronologie d'activité de
  MPM0220" — les fenêtres d'intrusion connues sont surlignées.
- **Détection d'anomalies** — "Quels utilisateurs sont anormaux sur le
  flux USB ?" : la détection à 3σ retrouve 30 des 70 insiders de la
  vérité terrain, et le chatbot les nomme.

### Reproduire

```bash
cd lab && python3 -m venv data/.venv && data/.venv/bin/pip install kagglehub pandas matplotlib
data/.venv/bin/python scripts/build_db.py all     # ~45 min, télécharge les datasets
cd ../demo && bun install && cp .env.example .env.local  # remplir
bun dev                                            # http://localhost:3000
```

Déploiement sur l'instance : `scripts/deploy-demo.sh <ip>` (image
buildée par GitHub Actions, publiée sur
`ghcr.io/fondation-io/qwen38-demo`).

## Prérequis

- CLI [scw](https://cli.scaleway.com) >= 2.58, `jq`, `ssh`, `python3`
- Compte Scaleway avec quota GPU, clé API IAM, clé SSH enregistrée
- Aucune dépendance à un gestionnaire de secrets : tout passe par `.env`

## Licence

MIT — voir `LICENSE`. Les datasets restent sous leurs licences
respectives (CERT : usage recherche ; GUIDE : conditions Kaggle).
