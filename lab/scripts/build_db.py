#!/usr/bin/env python3
"""Build lab/data/security-events.sqlite from the two candidate datasets.

Usage:
    python lab/scripts/build_db.py guide   # Microsoft GUIDE (O3)
    python lab/scripts/build_db.py cert    # CERT Insider Threat r4.2 (O2)
    python lab/scripts/build_db.py all

Datasets are fetched with kagglehub (anonymous, public datasets) and
cached under ~/.cache/kagglehub. The SQLite file is written to
lab/data/security-events.sqlite (gitignored).
"""
import sqlite3
import sys
from pathlib import Path

import kagglehub
import pandas as pd

DB = Path(__file__).resolve().parents[1] / "data" / "security-events.sqlite"
CHUNK = 200_000


def connect() -> sqlite3.Connection:
    DB.parent.mkdir(parents=True, exist_ok=True)
    con = sqlite3.connect(DB)
    con.execute("PRAGMA journal_mode=WAL")
    con.execute("PRAGMA synchronous=NORMAL")
    return con


def table_columns(con, table):
    return [r[1] for r in con.execute(f"PRAGMA table_info([{table}])")]


def ingest_csv(con, csv_path, table, split=None, rename=None):
    total = 0
    for chunk in pd.read_csv(csv_path, chunksize=CHUNK, low_memory=False):
        if rename:
            chunk = chunk.rename(columns=rename)
        if split is not None:
            chunk["split"] = split
        existing = table_columns(con, table)
        if existing:
            # aligne sur le schéma en place : colonnes en trop ignorées,
            # manquantes remplies à NULL (ex. GUIDE_Test a une colonne
            # "Usage" absente du train)
            chunk = chunk.reindex(columns=existing)
        chunk.to_sql(table, con, if_exists="append", index=False)
        total += len(chunk)
        print(f"  {table}: {total:,} lignes", flush=True)
    return total


def build_guide(con):
    root = Path(kagglehub.dataset_download(
        "Microsoft/microsoft-security-incident-prediction"))
    done = []
    if table_columns(con, "guide_evidence"):
        done = [r[0] for r in con.execute(
            "SELECT DISTINCT split FROM guide_evidence")]
    if "train" not in done:
        ingest_csv(con, root / "GUIDE_Train.csv", "guide_evidence",
                   split="train")
    if "test" not in done:
        ingest_csv(con, root / "GUIDE_Test.csv", "guide_evidence",
                   split="test")
    for col in ["IncidentId", "AlertId", "OrgId", "Category",
                "IncidentGrade", "EntityType", "Timestamp"]:
        con.execute(
            f"CREATE INDEX IF NOT EXISTS idx_guide_{col.lower()} "
            f"ON guide_evidence({col})")
    con.commit()


HTTP_SAMPLE_RATE = 0.05  # % d'utilisateurs non-insiders gardés pour http


def build_cert(con):
    root = Path(kagglehub.dataset_download(
        "andrihjonior/cert-insider-threat-dataset-r4-2"))
    data = next(p for p in root.rglob("logon.csv")).parent

    # Vérité terrain : liste des insiders (answers/insiders.csv)
    insiders_csv = next(root.rglob("insiders.csv"))
    con.execute("DROP TABLE IF EXISTS cert_insiders")
    ingest_csv(con, insiders_csv, "cert_insiders")
    insiders = {r[0] for r in con.execute(
        "SELECT DISTINCT [user] FROM cert_insiders")}

    # Annuaire : dernier snapshot LDAP disponible
    ldap_files = sorted((data / "LDAP").glob("*.csv"))
    if ldap_files:
        con.execute("DROP TABLE IF EXISTS cert_users")
        ingest_csv(con, ldap_files[-1], "cert_users")

    # Flux complets (volumes raisonnables)
    for name in ["logon", "device", "email", "file"]:
        table = f"cert_{name}"
        con.execute(f"DROP TABLE IF EXISTS {table}")
        ingest_csv(con, data / f"{name}.csv", table)

    # http.csv : 14 GB — on garde tout l'historique des insiders et un
    # échantillon d'utilisateurs sains (par utilisateur, pas par ligne,
    # pour conserver des historiques complets). Biais assumé et
    # documenté dans lab/research/.
    import hashlib
    def keep(user):
        if user in insiders:
            return True
        h = int(hashlib.md5(user.encode()).hexdigest()[:8], 16)
        return (h % 10_000) < HTTP_SAMPLE_RATE * 10_000
    con.execute("DROP TABLE IF EXISTS cert_http")
    total = 0
    for chunk in pd.read_csv(data / "http.csv", chunksize=CHUNK):
        chunk = chunk[chunk["user"].map(keep)]
        existing = table_columns(con, "cert_http")
        if existing:
            chunk = chunk.reindex(columns=existing)
        chunk.to_sql("cert_http", con, if_exists="append", index=False)
        total += len(chunk)
        print(f"  cert_http: {total:,} lignes gardées", flush=True)

    for table in ["cert_logon", "cert_device", "cert_email", "cert_file",
                  "cert_http"]:
        cols = table_columns(con, table)
        for col in ("user", "date", "pc"):
            if col in cols:
                con.execute(
                    f"CREATE INDEX IF NOT EXISTS idx_{table}_{col} "
                    f"ON {table}([{col}])")
    con.commit()


def main():
    targets = sys.argv[1:] or ["all"]
    con = connect()
    if targets[0] in ("guide", "all"):
        print("== GUIDE (O3) ==", flush=True)
        build_guide(con)
    if targets[0] in ("cert", "all"):
        print("== CERT r4.2 (O2) ==", flush=True)
        build_cert(con)
    for (name,) in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"):
        n = con.execute(f"SELECT COUNT(*) FROM [{name}]").fetchone()[0]
        print(f"{name}: {n:,} lignes")
    con.close()


if __name__ == "__main__":
    main()
