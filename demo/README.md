# Demo — chatbot "enquête sécurité"

Chatbot d'investigation sur la base d'évènements de sécurité du lab
(CERT Insider Threat r4.2 + Microsoft GUIDE), propulsé par le
Qwen3.8-27B-FP8 déployé via ce kit. Construit avec
[assistant-ui](https://www.assistant-ui.com) et l'AI SDK.

## Prérequis

1. Serveur vLLM du kit démarré avec le function calling
   (`--enable-auto-tool-choice --tool-call-parser qwen3_xml`, voir
   `../docs/runbook.md` phase 2).
2. Base SQLite construite : `../lab/scripts/build_db.py all` (voir
   `../lab/README.md`).
3. Bun installé.

## Démarrage

```bash
bun install
cp .env.example .env.local   # puis remplir
bun dev                      # http://localhost:3000
```

`.env.local` attend : `VLLM_BASE_URL`, `VLLM_API_KEY`, `VLLM_MODEL`,
`DB_PATH` (chemin absolu du SQLite), `PYTHON_BIN` (venv du lab),
`CHARTS_SCRIPT`, `CHARTS_OUT`.

## Architecture

- `app/api/chat/route.ts` — boucle d'agent AI SDK (`streamText`,
  max 8 étapes) sur le vLLM OpenAI-compatible, raisonnement désactivé
  par requête (`chat_template_kwargs`).
- `lib/db.ts` — SQLite `node:sqlite` lecture seule, garde-fous
  (SELECT/WITH uniquement, LIMIT 200 imposé).
- `lib/tools.ts` — 6 tools : `sql_query`, `describe_data` et 4 tools
  graphiques qui invoquent `../lab/scripts/charts.py` (PNG servis par
  `/api/charts/[name]`).
- `components/tool-uis/` — rendus assistant-ui : tables SQL repliables,
  graphiques inline avec badges insiders.

## Recette (validée 2026-08-25)

- A1 "Décris les données disponibles" → `describe_data`, tableaux par table.
- A2 "Qui s'est connecté entre 22h et 6h en octobre 2010 ?" → SQL,
  2 425 connexions, 108 utilisateurs, top 20.
- A3 "Montre l'activité USB de AAM0658..." → `usb_activity`, PNG avec
  fenêtre d'intrusion surlignée.
- A4 "Quels utilisateurs sont anormaux sur le flux USB ?" → `outliers`,
  149 utilisateurs dont 30 insiders confirmés listés.
