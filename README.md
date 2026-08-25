# qwen38-scaleway-kit

Déploiement, optimisation et recette automatisée de **Qwen3.8-27B-FP8**
servi par vLLM sur une instance Scaleway **L4-2-24G** (2× NVIDIA L4,
48 GB VRAM, ~€1.575/h). Config validée en conditions réelles le
2026-08-25 : 25-32 tok/s mono-requête (MTP), ~157 tok/s agrégés,
multimodal image, contexte 32k.

## Contenu

| Fichier | Usage |
|---------|-------|
| `docs/runbook.md` | Procédure détaillée pour un opérateur humain (phases 0-6, pièges vérifiés) |
| `docs/agent-playbook.md` | Procédure exécutable par un agent (Claude) : 7 étapes, sorties attendues, branches d'échec |
| `scripts/qwen38-recette.sh` | Recette automatisée V2 + T1-T5, rapport markdown dans `artifacts/`, exit 0 si tout passe |
| `.env.example` | Template des secrets Scaleway à copier vers `.env` (gitignored) |

## Démarrage rapide

```bash
cp .env.example .env      # remplir avec vos clés Scaleway
set -a; source .env; set +a
# puis suivre docs/runbook.md (humain) ou docs/agent-playbook.md (agent)
# une fois l'instance déployée :
scripts/qwen38-recette.sh <ip-instance>
```

## Prérequis

- CLI [scw](https://cli.scaleway.com) >= 2.58, `jq`, `ssh`, `python3`
- Compte Scaleway avec quota GPU, clé API IAM, clé SSH enregistrée
- Aucune dépendance à un gestionnaire de secrets : tout passe par `.env`

## Licence

MIT — voir `LICENSE`.
