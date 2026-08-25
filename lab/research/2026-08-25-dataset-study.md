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

## Prochaine étape proposée

Télécharger O2 et O3, profiler (volumes, schémas, cardinalités,
densité d'évènements malveillants), et prototyper 20 questions type du
chatbot contre chaque schéma pour juger lequel porte le mieux la démo.

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
