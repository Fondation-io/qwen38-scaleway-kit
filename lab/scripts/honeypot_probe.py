#!/usr/bin/env python3
"""Sonde : Qwen sait-il analyser le pot de miel IBM i SANS indice de diagnostic ?

Boucle agent réelle contre vLLM, tools sql_query exécutés contre la vraie base via
/api/sql (profil rssi = accès complet). Le prompt système ne contient QUE la
description de la base (tables, colonnes, accès), aucun indice de méthode. On pose
une question ouverte et on capture la trace SQL + la conclusion pour juger si Qwen
retrouve seul les signaux faibles (ex. QSECOFR ciblé depuis l'externe).

Env : VLLM_BASE, VLLM_KEY, VLLM_MODEL, SQL_BASE, SQL_AUTH, ROUTE_PATH.
Usage : honeypot_probe.py ["question libre"]
"""
import base64
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

ROUTE = Path(os.environ.get("ROUTE_PATH", "route.ts"))
BASE = os.environ["VLLM_BASE"].rstrip("/")
KEY = os.environ["VLLM_KEY"]
MODEL = os.environ["VLLM_MODEL"]
SQL_BASE = os.environ["SQL_BASE"].rstrip("/")
SQL_AUTH = os.environ["SQL_AUTH"]
PROFILE = os.environ.get("SQL_PROFILE", "rssi")

TOOLS = [
    {"type": "function", "function": {"name": "sql_query",
        "description": "Exécute une requête SQL en lecture seule (SELECT/WITH). Résultats plafonnés à 200 lignes.",
        "parameters": {"type": "object", "properties": {"sql": {"type": "string"}}, "required": ["sql"]}}},
    {"type": "function", "function": {"name": "describe_data",
        "description": "Profil des colonnes (data_profile). Ne couvre PAS le pot de miel.",
        "parameters": {"type": "object", "properties": {"table": {"type": "string"}}}}},
]


def _post(url, payload, headers, timeout):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST")
    req.add_header("content-type", "application/json")
    for k, v in headers.items():
        req.add_header(k, v)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def system_prompt():
    m = re.search(r"const SYSTEM_PROMPT = `(.+?)`;", ROUTE.read_text(), re.S)
    return m.group(1)


def run_sql(sql):
    auth = base64.b64encode(SQL_AUTH.encode()).decode()
    try:
        return _post(f"{SQL_BASE}/api/sql", {"sql": sql, "approved": True},
                     {"authorization": f"Basic {auth}", "x-demo-profile": PROFILE}, 120)
    except Exception as e:  # noqa: BLE001
        return {"error": f"exec_error: {e}"}


def describe(table):
    where = f" WHERE table_name = '{str(table).replace(chr(39), chr(39)*2)}'" if table else ""
    return run_sql("SELECT table_name, column_name, n_rows, n_distinct, n_null, "
                   f"min_value, max_value, top_values FROM data_profile{where}")


def chat(messages):
    return _post(f"{BASE}/v1/chat/completions",
                 {"model": MODEL, "messages": messages, "tools": TOOLS,
                  "tool_choice": "auto", "temperature": 0.3, "top_p": 0.9,
                  "max_tokens": 8000, "chat_template_kwargs": {"enable_thinking": True}},
                 {"authorization": f"Bearer {KEY}"}, 300)


def main():
    question = sys.argv[1] if len(sys.argv) > 1 else (
        "Voici le journal d'audit d'un pot de miel IBM i (schéma HONEYPOT). "
        "Parmi toutes les tentatives d'authentification échouées, distingue le "
        "bruit de fond des attaques réellement ciblées, et identifie la menace la "
        "plus crédible pour ce serveur. Justifie par les chiffres.")
    messages = [{"role": "system", "content": system_prompt()},
                {"role": "user", "content": question}]
    print(f"Q: {question}\n" + "=" * 80, flush=True)
    for step in range(30):
        msg = chat(messages)["choices"][0]["message"]
        tcs = msg.get("tool_calls") or []
        am = {"role": "assistant", "content": msg.get("content") or ""}
        if tcs:
            am["tool_calls"] = tcs
        messages.append(am)
        if not tcs:
            print("\n" + "=" * 80 + "\nCONCLUSION:\n" + (msg.get("content") or ""), flush=True)
            break
        for tc in tcs:
            fn = tc["function"]["name"]
            try:
                args = json.loads(tc["function"]["arguments"] or "{}")
            except Exception:  # noqa: BLE001
                args = {}
            if fn == "sql_query":
                sql = args.get("sql", "")
                out = run_sql(sql)
                nrows = out.get("rowCount") if isinstance(out, dict) else "?"
                err = out.get("error") if isinstance(out, dict) else None
                print(f"[{step}] SQL: {sql[:200]}", flush=True)
                print(f"      -> {('ERR '+str(err)) if err else str(nrows)+' lignes'} "
                      f"{json.dumps(out.get('rows', [])[:3], ensure_ascii=False)[:220]}", flush=True)
            elif fn == "describe_data":
                out = describe(args.get("table"))
                print(f"[{step}] describe_data({args.get('table')})", flush=True)
            else:
                out = {"error": f"tool inconnu: {fn}"}
            messages.append({"role": "tool", "tool_call_id": tc.get("id", ""),
                             "content": json.dumps(out, ensure_ascii=False)[:1200]})


if __name__ == "__main__":
    main()
