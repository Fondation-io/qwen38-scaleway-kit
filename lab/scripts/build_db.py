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
import os
import sqlite3
import sys
from pathlib import Path

import kagglehub
import pandas as pd

DB = Path(os.environ.get(
    "DB_PATH", Path(__file__).resolve().parents[1] / "data" / "security-events.sqlite"))
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

    # Annuaire : union de tous les snapshots LDAP mensuels (le dernier gagne
    # pour les attributs). Le seul dernier snapshot exclut les insiders qui ont
    # quitté l'entreprise (0/70 couverts) ; l'union les réintègre (70/70).
    ldap_files = sorted((data / "LDAP").glob("*.csv"))
    if ldap_files:
        con.execute("DROP TABLE IF EXISTS cert_users")
        merged = pd.concat(
            (pd.read_csv(f) for f in ldap_files), ignore_index=True)
        merged = merged.drop_duplicates(subset="user_id", keep="last")
        merged.to_sql("cert_users", con, if_exists="replace", index=False)
        print(f"  cert_users: {len(merged):,} profils (union {len(ldap_files)} "
              f"snapshots)", flush=True)

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


def build_ibmi(con):
    """Couche IBM i (W1, mapping enrichi O2) : réancre les flux CERT sur les
    vrais vecteurs d'exfiltration IBM i (sessions de transfert réseau, objets
    Db2/IFS, profils sur-privilégiés, usurpation de profil). Tables sources CERT
    laissées intactes ; on ajoute des tables compagnes + des vues v_qaudjrn_*.
    """
    import hashlib

    def h(s: str) -> int:
        return int(hashlib.md5(s.encode()).hexdigest()[:8], 16)

    # 1. Special authorities (F2). Synthétique, déterministe. Les insiders du
    # scénario 3 (admin) portent *ALLOBJ *SECADM ; ~8 % du parc porte une
    # autorité spéciale (aligné sur l'État de la sécurité IBM i 2026).
    s3 = {r[0] for r in con.execute(
        "SELECT [user] FROM cert_insiders WHERE dataset='4.2' AND scenario=3")}
    pool = ["*ALLOBJ", "*SECADM", "*JOBCTL", "*SPLCTL", "*SERVICE"]
    con.execute("DROP TABLE IF EXISTS ibmi_user_authorities")
    con.execute("CREATE TABLE ibmi_user_authorities "
                "(user_profile TEXT PRIMARY KEY, special_authorities TEXT)")
    rows = []
    for (uid,) in con.execute("SELECT user_id FROM cert_users"):
        if uid in s3:
            auth = "*ALLOBJ *SECADM"
        elif h(uid) % 100 < 8:
            auth = pool[h(uid + "salt") % len(pool)]
        else:
            auth = ""
        rows.append((uid, auth))
    con.executemany(
        "INSERT INTO ibmi_user_authorities VALUES (?,?)", rows)
    print(f"  ibmi_user_authorities: {len(rows):,} profils "
          f"({sum(1 for _,a in rows if a)} avec autorité spéciale)", flush=True)

    # 2. Usurpation de profil (F3, entrée PS). Synthétisée depuis la vérité
    # terrain : chaque insider du scénario 3 swappe vers le profil de son
    # supérieur au début de sa fenêtre malveillante.
    con.execute("DROP TABLE IF EXISTS ibmi_profile_swap")
    con.execute("""
        CREATE TABLE ibmi_profile_swap AS
        SELECT i.start        AS timestamp,
               'PS'           AS entry_type,
               i.[user]       AS from_profile,
               sup.user_id    AS to_profile,
               'set_profile_handle (QWTSETP)' AS action
        FROM cert_insiders i
        JOIN cert_users u   ON u.user_id = i.[user]
        JOIN cert_users sup ON sup.employee_name = u.supervisor
        WHERE i.dataset='4.2' AND i.scenario=3
    """)
    n_ps = con.execute("SELECT COUNT(*) FROM ibmi_profile_swap").fetchone()[0]
    print(f"  ibmi_profile_swap: {n_ps} événements PS", flush=True)

    # 3. Vues QAUDJRN (vocabulaire IBM i). cert_http volontairement non exposé.
    views = {
        "v_profiles": """
            SELECT u.user_id AS user_profile, u.employee_name, u.email, u.role,
                   u.business_unit, u.functional_unit, u.department, u.team,
                   u.supervisor,
                   COALESCE(a.special_authorities, '') AS special_authorities
            FROM cert_users u
            LEFT JOIN ibmi_user_authorities a ON a.user_profile = u.user_id
        """,
        # cert_logon -> signon interactif 5250 / démarrage de job (JS)
        "v_qaudjrn_signon": """
            SELECT id, date AS timestamp, [user] AS user_profile,
                   pc AS system, 'JS' AS entry_type,
                   CASE activity WHEN 'Logon' THEN 'signon'
                                 WHEN 'Logoff' THEN 'signoff' END AS action
            FROM cert_logon
        """,
        # cert_device -> ouverture/fermeture d'une session de transfert réseau
        # (Data Transfer ACS / FTP, job QZDASOINIT)
        "v_qaudjrn_transfer": """
            SELECT id, date AS timestamp, [user] AS user_profile,
                   pc AS system, 'QZDASOINIT' AS job_name, 'SO' AS entry_type,
                   'ACS/FTP' AS channel,
                   CASE activity WHEN 'Connect' THEN 'session_open'
                                 WHEN 'Disconnect' THEN 'session_close' END
                       AS action
            FROM cert_device
        """,
        # cert_file -> objet Db2/IFS transféré hors système (ZR : audité
        # seulement si l'audit objet est actif, cf. F4)
        "v_qaudjrn_object": """
            SELECT id, date AS timestamp, [user] AS user_profile,
                   pc AS system, 'ZR' AS entry_type,
                   filename AS object_name, content AS object_preview
            FROM cert_file
        """,
        # cert_email -> distribution SMTP sortante (ML)
        "v_qaudjrn_mail": """
            SELECT id, date AS timestamp, [user] AS user_profile,
                   pc AS system, 'ML' AS entry_type,
                   [to] AS recipients, [from] AS sender, size,
                   attachments, content
            FROM cert_email
        """,
        "v_qaudjrn_profile_swap": "SELECT * FROM ibmi_profile_swap",
        # baseline quotidienne renommée en vocabulaire IBM i, http retiré
        "v_daily_baseline": """
            SELECT [user] AS user_profile, day, n_events, mean_events,
                   std_events,
                   CASE stream WHEN 'logon'  THEN 'signon'
                               WHEN 'device' THEN 'transfer_session'
                               WHEN 'email'  THEN 'mail'
                               WHEN 'file'   THEN 'object_transfer' END AS stream
            FROM cert_daily_baseline
            WHERE stream <> 'http'
        """,
    }
    for name, sql in views.items():
        con.execute(f"DROP VIEW IF EXISTS {name}")
        con.execute(f"CREATE VIEW {name} AS {sql}")
        print(f"  vue {name}", flush=True)
    con.commit()


def build_stats(con):
    """Précalculs : baselines quotidiennes par utilisateur et profil
    statistique des variables, pour des réponses chatbot instantanées."""
    # 1. cert_daily_baseline : user × flux × jour, avec moyenne et
    # écart-type par utilisateur (sur ses jours actifs).
    con.execute("DROP TABLE IF EXISTS cert_daily_baseline")
    frames = []
    for stream in ["logon", "device", "email", "file", "http"]:
        df = pd.read_sql(f"SELECT [user], date FROM cert_{stream}", con)
        if df.empty:
            continue
        day = pd.to_datetime(df["date"], format="%m/%d/%Y %H:%M:%S")
        df["day"] = day.dt.strftime("%Y-%m-%d")
        daily = (df.groupby(["user", "day"]).size()
                 .rename("n_events").reset_index())
        daily["stream"] = stream
        stats = (daily.groupby("user")["n_events"]
                 .agg(mean_events="mean", std_events="std").reset_index())
        daily = daily.merge(stats, on="user")
        frames.append(daily)
        print(f"  baseline {stream}: {len(daily):,} user-jours", flush=True)
    baseline = pd.concat(frames, ignore_index=True)
    baseline["std_events"] = baseline["std_events"].fillna(0.0)
    baseline.to_sql("cert_daily_baseline", con, index=False)
    con.execute("CREATE INDEX idx_baseline_user ON cert_daily_baseline([user])")
    con.execute("CREATE INDEX idx_baseline_day ON cert_daily_baseline(day)")
    con.execute("CREATE INDEX idx_baseline_stream ON cert_daily_baseline(stream)")

    # 2. data_profile : nature de chaque variable de chaque table.
    con.execute("DROP TABLE IF EXISTS data_profile")
    rows = []
    tables = [r[0] for r in con.execute(
        "SELECT name FROM sqlite_master WHERE type='table' "
        "AND name NOT IN ('data_profile','cert_daily_baseline')")]
    for table in tables:
        n = con.execute(f"SELECT COUNT(*) FROM [{table}]").fetchone()[0]
        for col in table_columns(con, table):
            distinct, nulls, mn, mx = con.execute(
                f"SELECT COUNT(DISTINCT [{col}]), "
                f"SUM(CASE WHEN [{col}] IS NULL THEN 1 ELSE 0 END), "
                f"MIN([{col}]), MAX([{col}]) FROM [{table}]").fetchone()
            top = con.execute(
                f"SELECT [{col}], COUNT(*) c FROM [{table}] "
                f"WHERE [{col}] IS NOT NULL GROUP BY [{col}] "
                f"ORDER BY c DESC LIMIT 5").fetchall()
            rows.append({
                "table_name": table, "column_name": col, "n_rows": n,
                "n_distinct": distinct, "n_null": nulls or 0,
                "min_value": str(mn)[:120], "max_value": str(mx)[:120],
                "top_values": "; ".join(
                    f"{str(v)[:40]} ({c})" for v, c in top)})
            print(f"  profil {table}.{col}", flush=True)
    pd.DataFrame(rows).to_sql("data_profile", con, index=False)
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
    if targets[0] in ("stats", "all"):
        print("== Précalculs (baselines + profil) ==", flush=True)
        build_stats(con)
    if targets[0] in ("ibmi", "all"):
        print("== Couche IBM i (vues QAUDJRN + enrichissement) ==", flush=True)
        build_ibmi(con)
    for (name,) in con.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"):
        n = con.execute(f"SELECT COUNT(*) FROM [{name}]").fetchone()[0]
        print(f"{name}: {n:,} lignes")
    con.close()


if __name__ == "__main__":
    main()
