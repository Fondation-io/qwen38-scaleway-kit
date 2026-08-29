"""Passerelle HTTP -> Db2 (base GESTION) pour le workspace gestion de la démo.

Chaque requête s'exécute avec le COMPTE Db2 du rôle demandé (consult, analyste,
operateur, admin) : les GRANTs Db2 réels s'appliquent — la gate applicative de
l'app Next est la 1ère ligne, les privilèges base la 2ème. Deux endpoints :

  POST /query {sql, role}            -> SELECT (ou SQL libre pour admin)
  POST /call  {proc, args, role}     -> procédures stockées whitelistées

Aucune credential ne quitte ce conteneur ; l'app ne connaît que l'URL.
"""

import json
import os
import threading

import ibm_db
from flask import Flask, jsonify, request

app = Flask(__name__)

DB2_HOST = os.environ.get("DB2_HOST", "db2")
DB2_PORT = os.environ.get("DB2_PORT", "50000")
DB2_DB = os.environ.get("DB2_DB", "GESTION")

ROLES = {
    "consult": ("consult", os.environ.get("CONSULT_PW", "")),
    "analyste": ("analyste", os.environ.get("ANALYSTE_PW", "")),
    "operateur": ("operateur", os.environ.get("OPERATEUR_PW", "")),
    "admin": ("admin", os.environ.get("ADMIN_PW", "")),
}

MAX_ROWS = 200
MAX_SQL_LENGTH = 5000

# Procédures autorisées : nom -> (signature CALL, liste ordonnée des args).
PROCEDURES = {
    "SET_ORDER_STATUS": (
        "CALL OLIST.SET_ORDER_STATUS(?, ?)",
        ["order_id", "status"],
    ),
    "RECORD_PAYMENT": (
        "CALL OLIST.RECORD_PAYMENT(?, ?, ?, ?)",
        ["order_id", "payment_type", "installments", "value"],
    ),
}

_lock = threading.Lock()
_conns: dict[str, object] = {}


def get_conn(role: str):
    """Connexion mise en cache par rôle (revalidée par ping, reconnectée si morte)."""
    user, pw = ROLES[role]
    with _lock:
        conn = _conns.get(role)
        if conn is not None:
            try:
                ibm_db.exec_immediate(conn, "SELECT 1 FROM SYSIBM.SYSDUMMY1")
                return conn
            except Exception:
                try:
                    ibm_db.close(conn)
                except Exception:
                    pass
                _conns.pop(role, None)
        dsn = (
            f"DATABASE={DB2_DB};HOSTNAME={DB2_HOST};PORT={DB2_PORT};"
            f"PROTOCOL=TCPIP;UID={user};PWD={pw};"
        )
        conn = ibm_db.connect(dsn, "", "")
        _conns[role] = conn
        return conn


def db2_error(exc: Exception) -> tuple[str, str | None]:
    """Extrait (message, sqlstate) d'une erreur ibm_db."""
    msg = str(exc)
    state = None
    for token in ("SQLSTATE=", "SQLSTATE "):
        if token in msg:
            state = msg.split(token, 1)[1][:5]
            break
    return msg, state


def fetch_all(stmt) -> dict:
    columns = [
        ibm_db.field_name(stmt, i) for i in range(ibm_db.num_fields(stmt))
    ]
    rows = []
    row = ibm_db.fetch_tuple(stmt)
    while row is not False and len(rows) < MAX_ROWS:
        rows.append(
            [v.strip() if isinstance(v, str) else v for v in row]
        )
        row = ibm_db.fetch_tuple(stmt)
    return {"columns": columns, "rows": rows, "rowCount": len(rows)}


def json_safe(result: dict) -> dict:
    # Decimal / datetime -> str, via un round-trip json par défaut str().
    return json.loads(json.dumps(result, default=str))


@app.get("/health")
def health():
    return jsonify({"ok": True})


@app.post("/query")
def query():
    body = request.get_json(silent=True) or {}
    sql = body.get("sql", "")
    role = body.get("role", "")
    if role not in ROLES:
        return jsonify({"error": f"Rôle inconnu : {role}"}), 400
    if not isinstance(sql, str) or not sql.strip():
        return jsonify({"error": "Requête SQL vide."}), 400
    if len(sql) > MAX_SQL_LENGTH:
        return jsonify({"error": f"Requête trop longue (max {MAX_SQL_LENGTH})."}), 400
    try:
        conn = get_conn(role)
        stmt = ibm_db.exec_immediate(conn, sql.strip().rstrip(";"))
        if ibm_db.num_fields(stmt):
            return jsonify(json_safe(fetch_all(stmt)))
        # Instruction sans result set (write direct du rôle admin).
        return jsonify({"columns": [], "rows": [], "rowCount": 0,
                        "affectedRows": ibm_db.num_rows(stmt)})
    except Exception as exc:  # noqa: BLE001 - toute erreur Db2 remonte en JSON
        msg, state = db2_error(exc)
        return jsonify({"error": msg, "sqlstate": state})


@app.post("/call")
def call_proc():
    body = request.get_json(silent=True) or {}
    role = body.get("role", "")
    proc = body.get("proc", "")
    args = body.get("args") or {}
    if role not in ROLES:
        return jsonify({"error": f"Rôle inconnu : {role}"}), 400
    if proc not in PROCEDURES:
        return jsonify({"error": f"Procédure non autorisée : {proc}"}), 400
    call_sql, arg_names = PROCEDURES[proc]
    params = tuple(args.get(name) for name in arg_names)
    try:
        conn = get_conn(role)
        stmt = ibm_db.prepare(conn, call_sql)
        ibm_db.execute(stmt, params)
        return jsonify({"ok": True, "proc": proc, "args": args})
    except Exception as exc:  # noqa: BLE001
        msg, state = db2_error(exc)
        return jsonify({"error": msg, "sqlstate": state})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)
