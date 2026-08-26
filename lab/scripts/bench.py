#!/usr/bin/env python3
"""Bench qualité Qwen vs Granite : boucle agent headless sur les questions,
tools exécutés contre la vraie base via /api/sql, capture réponse + SQL +
tokens (raisonnement via /tokenize, total via usage).

Usage:
    bench.py qwen     # écrit lab/bench/results-qwen.json
    bench.py granite  # écrit lab/bench/results-granite.json

Env requis :
    SQL_BASE   ex. https://demo-qwen.tech-leads.cc   (endpoint /api/sql)
    SQL_AUTH   ex. demo:motdepasse                    (basic auth)
"""
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ROUTE = ROOT.parent / "demo" / "app" / "api" / "chat" / "route.ts"

MODELS = {
    "qwen": {
        "base": "http://localhost:18000",
        "model": "Qwen/Qwen3.8-27B-FP8",
        "key": "8366d9ba83d654a2d79cdc467a9c85c5a943a1144ac7ecdf",
    },
    "granite": {
        "base": "http://localhost:18001",
        "model": "granite-4.2-30b",
        "key": "fb03a012cbc3db3a72af3ecb0965ecdcaf55b7cafca350de",
    },
}

TOOLS = [
    {"type": "function", "function": {
        "name": "sql_query",
        "description": "Exécute une requête SQL en lecture seule (SELECT/WITH) sur la base d'audit Db2 for i (schéma SECAUDIT). Résultats plafonnés à 200 lignes.",
        "parameters": {"type": "object", "properties": {
            "sql": {"type": "string", "description": "Requête SQL (SELECT ou WITH ... SELECT)"}},
            "required": ["sql"]}}},
    {"type": "function", "function": {
        "name": "describe_data",
        "description": "Retourne le profil des données (data_profile) : par colonne, nb de lignes, valeurs distinctes, nulls, min/max, top valeurs. Filtrable par table.",
        "parameters": {"type": "object", "properties": {
            "table": {"type": "string", "description": "Nom de table pour filtrer (optionnel)"}}}}},
]

SQL_BASE = os.environ["SQL_BASE"].rstrip("/")
SQL_AUTH = os.environ["SQL_AUTH"]


def _post(url, payload, headers, timeout):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("content-type", "application/json")
    for k, v in headers.items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def system_prompt():
    txt = ROUTE.read_text()
    m = re.search(r"const SYSTEM_PROMPT = `(.+?)`;", txt, re.S)
    if not m:
        raise SystemExit("SYSTEM_PROMPT introuvable dans route.ts")
    return m.group(1)


def run_sql(sql):
    import base64
    auth = base64.b64encode(SQL_AUTH.encode()).decode()
    try:
        return _post(f"{SQL_BASE}/api/sql", {"sql": sql, "approved": True},
                     {"authorization": f"Basic {auth}"}, 120)
    except Exception as e:  # noqa: BLE001
        return {"error": f"exec_error: {e}"}


def describe(table):
    where = ""
    if table:
        safe = str(table).replace("'", "''")
        where = f" WHERE table_name = '{safe}'"
    return run_sql(
        "SELECT table_name, column_name, n_rows, n_distinct, n_null, "
        f"min_value, max_value, top_values FROM data_profile{where}")


def tokenize(cfg, text):
    if not text:
        return 0
    try:
        d = _post(f"{cfg['base']}/tokenize",
                  {"model": cfg["model"], "prompt": text},
                  {"authorization": f"Bearer {cfg['key']}"}, 60)
        return int(d.get("count") or 0)
    except Exception:  # noqa: BLE001
        return 0


def chat(cfg, messages):
    return _post(
        f"{cfg['base']}/v1/chat/completions",
        {"model": cfg["model"], "messages": messages, "tools": TOOLS,
         "tool_choice": "auto", "temperature": 0.3, "top_p": 0.9,
         "max_tokens": 16000,
         "chat_template_kwargs": {"enable_thinking": True}},
        {"authorization": f"Bearer {cfg['key']}"}, 300)


def run_question(cfg, sys_prompt, question, max_steps=30):
    messages = [{"role": "system", "content": sys_prompt},
                {"role": "user", "content": question}]
    sqls, errors, reasonings = [], [], []
    gen_tokens = prompt_tokens = reasoning_tokens = 0
    steps = 0
    final = ""
    for _ in range(max_steps):
        steps += 1
        resp = chat(cfg, messages)
        ch = resp["choices"][0]
        msg = ch["message"]
        usage = resp.get("usage") or {}
        gen_tokens += int(usage.get("completion_tokens") or 0)
        prompt_tokens = int(usage.get("prompt_tokens") or 0)
        reasoning = msg.get("reasoning") or msg.get("reasoning_content") or ""
        if reasoning:
            reasonings.append(reasoning)
            reasoning_tokens += tokenize(cfg, reasoning)
        tool_calls = msg.get("tool_calls") or []
        # rejoue le message assistant (sans reasoning) pour le contexte
        assistant_msg = {"role": "assistant",
                         "content": msg.get("content") or ""}
        if tool_calls:
            assistant_msg["tool_calls"] = tool_calls
        messages.append(assistant_msg)
        if not tool_calls:
            final = msg.get("content") or ""
            break
        for tc in tool_calls:
            fn = tc["function"]["name"]
            try:
                args = json.loads(tc["function"]["arguments"] or "{}")
            except Exception:  # noqa: BLE001
                args = {}
            if fn == "sql_query":
                sql = args.get("sql", "")
                sqls.append(sql)
                out = run_sql(sql)
            elif fn == "describe_data":
                out = describe(args.get("table"))
            else:
                out = {"error": f"tool inconnu: {fn}"}
            if isinstance(out, dict) and out.get("error"):
                errors.append(out["error"])
            messages.append({"role": "tool", "tool_call_id": tc.get("id", ""),
                             "content": json.dumps(out, ensure_ascii=False)[:6000]})
    return {
        "final": final,
        "sqls": sqls,
        "errors": errors,
        "steps": steps,
        "gen_tokens": gen_tokens,
        "reasoning_tokens": reasoning_tokens,
        "prompt_tokens_last": prompt_tokens,
        "reasoning": "\n---\n".join(reasonings)[:8000],
    }


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "qwen"
    only = {a.upper() for a in sys.argv[2:]}  # IDs à rejouer (vide = tous)
    cfg = MODELS[which]
    sys_prompt = system_prompt()
    questions = json.loads((ROOT / "bench" / "questions.json").read_text())
    out_path = ROOT / "bench" / f"results-{which}.json"

    # Fusion : on repart des résultats existants et on ne remplace que les IDs
    # ciblés, pour préserver le reste du run.
    existing = {}
    if only and out_path.exists():
        existing = {r["id"]: r for r in json.loads(out_path.read_text())}

    for q in questions:
        if only and q["id"] not in only:
            continue
        t0 = time.time()
        try:
            r = run_question(cfg, sys_prompt, q["q"])
        except Exception as e:  # noqa: BLE001
            r = {"final": f"[HARNESS ERROR] {e}", "sqls": [], "errors": [str(e)],
                 "steps": 0, "gen_tokens": 0, "reasoning_tokens": 0,
                 "prompt_tokens_last": 0, "reasoning": ""}
        r.update({"id": q["id"], "level": q["level"], "question": q["q"],
                  "seconds": round(time.time() - t0, 1)})
        existing[q["id"]] = r
        ordered = [existing[qq["id"]] for qq in questions if qq["id"] in existing]
        out_path.write_text(json.dumps(ordered, ensure_ascii=False, indent=2))
        print(f"[{which}] {q['id']} {q['level']} steps={r['steps']} "
              f"gen={r['gen_tokens']} reason={r['reasoning_tokens']} "
              f"final_vide={not r['final'].strip()} {r['seconds']}s", flush=True)
    print(f"== {which} terminé : {out_path}", flush=True)


if __name__ == "__main__":
    main()
