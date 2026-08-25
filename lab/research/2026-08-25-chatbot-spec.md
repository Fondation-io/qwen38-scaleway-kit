# Spec + plan — chatbot démo "enquête sécurité"

Date : 2026-08-25. Suite de `2026-08-25-dataset-study.md` (D1 :
NL→SQL + tools graphiques + précalculs).

## Décisions

- **D2 — UI : assistant-ui** (vs AI Elements). Motifs : skill de site
  officielle pour agents (skill.md/AGENTS.md/MCP docs), generative UI
  native pour rendre les tool results en composants React (nos PNG),
  support backend OpenAI-compatible. AI Elements n'expose pas de skill.
- **D3 — Stack** : Next.js 15 App Router (requis assistant-ui), Bun
  comme package manager, `@assistant-ui/react` + runtime AI SDK,
  provider `@ai-sdk/openai-compatible` pointé sur le vLLM du kit.
- **D4 — Tools côté serveur** (API route `/api/chat`, AI SDK
  `streamText`) :
  1. `sql_query(sql)` — SQLite lecture seule (`mode=ro`), garde-fous :
     un seul SELECT, LIMIT plafonné à 200, refus PRAGMA/ATTACH/CTE
     d'écriture.
  2. `describe_data(table?)` — lit `data_profile` (précalculé).
  3. `user_timeline`, `usb_activity`, `after_hours`, `outliers` —
     spawn de `lab/scripts/charts.py` (venv Python du lab), retourne le
     JSON du script + URL du PNG servie par `/api/charts/[name]`.
- **D5 — Serveur modèle** : vLLM redémarré avec
  `--enable-auto-tool-choice --tool-call-parser hermes` (parser Qwen3).
  Chat en `enable_thinking:false` (latence) via extra body.
- **D6 — Emplacement** : `demo/` dans le repo du kit. `.env.local`
  (gitignored) : `VLLM_BASE_URL`, `VLLM_API_KEY`, `DB_PATH`,
  `PYTHON_BIN`.

## Critères d'acceptation

- A1 : "Décris les données disponibles" → réponse depuis
  `data_profile` sans balayage des tables brutes.
- A2 : "Combien de connexions hors horaires en octobre 2010 ?" →
  SQL généré, résultat correct affiché avec le SQL visible.
- A3 : "Montre l'activité USB de AAM0658 autour de sa fenêtre
  d'intrusion" → tool `usb_activity` appelé, PNG affiché dans le chat.
- A4 : "Quels utilisateurs sont anormaux sur le flux USB ?" → tool
  `outliers`, PNG + liste incluant des insiders confirmés.
- A5 : démarrage complet documenté en une commande (`bun dev` après
  `.env.local`), README du demo/ à jour.

## Plan d'implémentation

1. Scaffold `demo/` (create-assistant-ui ou init manuel Next+assistant-ui). → vérif : page chat vide qui build.
2. Backend `/api/chat` : provider openai-compatible → vLLM, 6 tools
   D4, prompt système (schéma des tables + extrait data_profile +
   consignes SQL). → vérif : curl streaming avec tool call.
3. Frontend : tool UIs assistant-ui (makeAssistantToolUI) — rendu SQL
   + table de résultats, rendu image pour les 4 tools graphiques.
   → vérif : A2-A4 en navigateur.
4. Recette A1-A5 + captures d'écran. → livraison.

Étapes 2 et 3 parallélisables après le scaffold (subagents).
