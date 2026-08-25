# Étude — dataset d'évènements de sécurité pour la démo chatbot

Date : 2026-08-25. Statut : première étude, aucune décision prise.

## Objectif

Trouver une base d'évènements de sécurité détectés, la plus proche
possible d'un cas réel, interrogeable par un chatbot interne (servi par
le déploiement Qwen3.8-27B de ce kit). Cible idéale : évènements
d'intrusion sur IBM i (AS/400).

## Méthodologie

Recherche web ciblée Kaggle (2026-08-25) : IBM i / AS400 / QAUDJRN,
puis élargissement aux datasets SIEM/IDS réalistes, datasets d'incidents
SOC et insider threat. Non couvert à ce stade : téléchargement et
profiling effectif des données (étape suivante).

## Constats

**F1 — Aucun dataset IBM i sur Kaggle.** Aucune base publique QAUDJRN ou
AS/400, sur Kaggle ou ailleurs. L'IBM i est absent des datasets de
recherche publics, dominés par les mondes réseau, Linux et Windows.

**F2 — Le format QAUDJRN est bien documenté publiquement.** Types
d'entrées du journal d'audit (PW mot de passe invalide, AF échec
d'autorité, CA changement d'autorité, SV valeur système modifiée, OW
changement de propriétaire, DS reset DST, SO sécurité serveur…), champs
et sémantique décrits par [Fortra](https://power.fortra.com/resources/guides/integrating-ibm-i-security-events-your-siem),
le [parser Google SecOps AS/400](https://docs.cloud.google.com/chronicle/docs/ingestion/default-parsers/ibm-as400)
et le [guide forensique 400school](https://400school.com/assets/files/sc22.pdf).
Générer un dataset synthétique fidèle au format QAUDJRN est donc
faisable.

**F3 — Quatre familles de substituts existent sur Kaggle** (détail dans
le comparatif ci-dessous) : incidents SOC réels (Microsoft GUIDE),
insider threat synthétique haute-fidélité (CERT CMU), logs synthétiques
légers, et les classiques IDS réseau (CICIDS2017, UNSW-NB15, NSL-KDD)
— ces derniers étant des flux réseau featurisés, peu parlants pour un
chatbot.

## Options

| | O1 QAUDJRN synthétique (à générer) | O2 CERT Insider Threat r4.2 | O3 Microsoft GUIDE | O4 Logs synthétiques légers |
|---|---|---|---|---|
| Source | généré par nous selon F2 | [Kaggle r4.2](https://www.kaggle.com/datasets/andrihjonior/cert-insider-threat-dataset-r4-2) (CMU CERT) | [Kaggle GUIDE](https://www.kaggle.com/code/tasoschatz/tasos-incident-triage-prediction-microsoft/input) | [Normal/Bot/Scan](https://www.kaggle.com/datasets/developerghost/intrusion-detection-logs-normal-bot-scan), [Threat Detection Logs](https://www.kaggle.com/datasets/aryan208/cybersecurity-threat-detection-logs) |
| Nature | synthétique, format IBM i exact | synthétique haute-fidélité, scénarios d'attaque annotés | télémétrie réelle anonymisée, 1M incidents, 6,1k orgs, labels de triage SOC, 441 techniques MITRE | synthétique simple |
| Contenu | entrées journal PW/AF/CA/SV… | logon, fichiers, emails, HTTP, USB par employé | alertes, incidents, entités, verdicts TP/FP/BP | lignes de logs réseau/firewall |
| Pertinence IBM i | maximale | moyenne (évènements système/utilisateur transposables) | nulle (SOC générique) | nulle |
| Réalisme | dépend de notre générateur | reconnu en recherche | maximal | faible |
| Effort | élevé (générateur à écrire et valider) | faible (CSV prêts) | moyen (volume, schéma riche) | minimal |

## Lecture

Le choix dépend de ce que la démo doit prouver :

- Démo "chatbot sur la sécurité d'un IBM i" → O1, seule option crédible
  face à un client IBM i ; O2 peut servir de squelette de scénarios
  (les récits d'intrusion du CERT se transposent en séquences QAUDJRN).
- Démo "chatbot SOC générique le plus réaliste possible" → O3, données
  réelles, vocabulaire MITRE, questions de triage naturelles.
- Maquette rapide jetable → O4.

Piste hybride notée : générer O1 en rejouant les scénarios d'attaque
annotés d'O2 dans le vocabulaire QAUDJRN, pour cumuler fidélité de
format et réalisme comportemental.

## Phase 2 — téléchargement, ingestion SQLite, mesures (2026-08-25)

O2 et O3 téléchargés (kagglehub, accès anonyme) et ingérés dans
`lab/data/security-events.sqlite` (7,5 Go, gitignored) via
`lab/scripts/build_db.py`. Volumes :

| Table | Lignes | Contenu |
|-------|--------|---------|
| guide_evidence | 13 664 829 | O3 train+test, colonne `split` |
| cert_logon / device / file / email | 854k / 405k / 446k / 2,6M | O2, flux complets |
| cert_http | 2 281 739 | O2, insiders complets + 5 % des autres utilisateurs (échantillonnage par utilisateur, biais assumé : le web des utilisateurs sains est sous-représenté) |
| cert_insiders | 191 | vérité terrain toutes releases — filtrer `dataset='4.2'` (70 insiders) |
| cert_users | 845 | dernier snapshot LDAP (nom, rôle, département, superviseur) |

**F4 — GUIDE est anonymisé au point de casser le storytelling.** Titres
d'alertes, comptes, fichiers, URLs sont des codes numériques. Restent
lisibles : Category (18), EntityType (21), MitreTechniques (390+),
IncidentGrade, verdicts. Un chatbot peut répondre "combien d'incidents
d'exfiltration TruePositive" mais pas raconter une attaque.

**F5 — CERT r4.2 est narrativement riche.** Utilisateurs nommés avec
organigramme, horodatages, 5 scénarios d'intrusion documentés
(`answers/scenarios.txt`) avec fenêtres exactes par insider. Les
comportements sont visibles dans les données (ex. pics USB d'un insider
scénario 2 : 6 branchements le 21/10/2010 contre 1-2 en temps normal).
Limite : contenus texte (emails, pages web) = sacs de mots aléatoires,
seuls les métadonnées et les motifs temporels portent du sens.

**F6 — Latences SQLite mesurées.** CERT : 0-1 ms (requêtes indexées
user/date/pc), temps réel garanti. GUIDE : 39 ms sur requête ciblée par
IncidentId, mais 3,3-11,4 s sur les agrégations pleine table (13,7M
lignes). Pour un chatbot temps réel sur GUIDE : pré-agrégats ou tables
de synthèse nécessaires.

**F7 — Verdict d'usage.** O2 (CERT) porte la démo "enquête sur une
intrusion" : questions naturelles ("qui s'est connecté après minuit ?",
"montre l'activité USB de X avant son départ"), réponses nominatives,
scénarios rejouables. O3 (GUIDE) porte la démo "métriques SOC" en
complément. La piste O1 (transposition QAUDJRN) se nourrira des
scénarios CERT.

## Prochaine étape proposée

Choisir l'angle démo (enquête CERT, métriques GUIDE, ou les deux), puis
brancher le chatbot : NL→SQL sur la SQLite avec le Qwen3.8-27B du kit,
plus tables de pré-agrégats GUIDE si cet axe est retenu.

## Sources

- [Fortra — Integrating IBM i Security Events into Your SIEM](https://power.fortra.com/resources/guides/integrating-ibm-i-security-events-your-siem)
- [Google SecOps — Collect IBM AS/400 logs](https://docs.cloud.google.com/chronicle/docs/ingestion/default-parsers/ibm-as400)
- [400school — QAUDJRN Auditing and Forensics (PDF)](https://400school.com/assets/files/sc22.pdf)
- [Kaggle — CERT Insider Threat Dataset r4.2](https://www.kaggle.com/datasets/andrihjonior/cert-insider-threat-dataset-r4-2)
- [CERT Insider Threat Dataset — vue d'ensemble](https://www.emergentmind.com/topics/cert-insider-threat-dataset)
- [Kaggle — GUIDE input (incident triage)](https://www.kaggle.com/code/tasoschatz/tasos-incident-triage-prediction-microsoft/input)
- [arXiv — AI-Driven Guided Response (description GUIDE)](https://arxiv.org/pdf/2407.09017)
- [Kaggle — Intrusion Detection Logs (Normal, Bot, Scan)](https://www.kaggle.com/datasets/developerghost/intrusion-detection-logs-normal-bot-scan)
- [Kaggle — Cybersecurity Threat Detection Logs](https://www.kaggle.com/datasets/aryan208/cybersecurity-threat-detection-logs)
- [Kaggle — Cybersecurity Intrusion Detection Dataset](https://www.kaggle.com/datasets/dnkumars/cybersecurity-intrusion-detection-dataset)
