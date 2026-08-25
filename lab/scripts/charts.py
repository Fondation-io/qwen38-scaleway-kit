#!/usr/bin/env python3
"""Tools graphiques paramétrés pour le chatbot — PAS de génération de code.

Chaque tool est une fonction fixe : le modèle choisit le tool et ses
paramètres (utilisateur, intervalle de temps), le rendu est déterministe.
Sortie : PNG dans lab/output/ + résumé JSON sur stdout (pour que le
chatbot commente le graphique).

Usage CLI (miroir exact des tools exposés au modèle) :
    charts.py user_timeline   --user AAM0658 [--start 2010-07-01 --end 2010-11-01]
    charts.py usb_activity    --user AAM0658 [--start ... --end ...]
    charts.py after_hours     [--start ... --end ...] [--top 15]
    charts.py outliers        [--stream device] [--start ... --end ...] [--sigma 3]

Palette et règles : skill dataviz (couleurs validées CVD, un seul axe,
marques fines, grille discrète, légende dès 2 séries).
"""
import argparse
import json
import os
import sqlite3
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

LAB = Path(__file__).resolve().parents[1]
DB = Path(os.environ.get("DB_PATH", LAB / "data" / "security-events.sqlite"))
OUT = Path(os.environ.get("CHARTS_OUT", LAB / "output"))

# Palette de référence (dataviz skill, mode clair, ordre fixe non cyclé)
SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"]  # slots 1-4
CRITICAL = "#d03b3b"   # statut réservé : fenêtre d'intrusion
SURFACE, INK, MUTED, GRID = "#fcfcfb", "#0b0b0b", "#898781", "#e1e0d9"


def style_axes(ax, title):
    ax.set_facecolor(SURFACE)
    ax.figure.set_facecolor(SURFACE)
    ax.set_title(title, color=INK, fontsize=11, loc="left")
    ax.tick_params(colors=MUTED, labelsize=8)
    ax.grid(True, axis="y", color=GRID, linewidth=0.6)
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRID)


def insider_window(con, user):
    row = con.execute(
        "SELECT start, end, scenario FROM cert_insiders "
        "WHERE dataset='4.2' AND [user]=?", (user,)).fetchone()
    if not row:
        return None
    fmt = pd.to_datetime
    return {"start": fmt(row[0]), "end": fmt(row[1]), "scenario": row[2]}


def shade_window(ax, win):
    if win:
        ax.axvspan(win["start"], win["end"], color=CRITICAL, alpha=0.12)
        ax.text(win["start"], ax.get_ylim()[1], f" intrusion (scénario {win['scenario']})",
                color=CRITICAL, fontsize=8, va="top")


def daily(con, user, start, end):
    df = pd.read_sql(
        "SELECT stream, day, n_events FROM cert_daily_baseline "
        "WHERE [user]=? ORDER BY day", con, params=(user,))
    df["day"] = pd.to_datetime(df["day"])
    if start:
        df = df[df["day"] >= pd.to_datetime(start)]
    if end:
        df = df[df["day"] <= pd.to_datetime(end)]
    return df


def save(fig, name, summary):
    OUT.mkdir(exist_ok=True)
    path = OUT / f"{name}.png"
    fig.savefig(path, dpi=144, bbox_inches="tight")
    plt.close(fig)
    summary["chart"] = str(path)
    print(json.dumps(summary, ensure_ascii=False, default=str))


def user_timeline(con, args):
    """Activité quotidienne d'un utilisateur, une ligne par flux."""
    df = daily(con, args.user, args.start, args.end)
    fig, ax = plt.subplots(figsize=(9, 4))
    streams = ["logon", "email", "http", "device"]  # ordre fixe = slots
    for i, s in enumerate(streams):
        sub = df[df["stream"] == s]
        if len(sub):
            ax.plot(sub["day"], sub["n_events"], color=SERIES[i],
                    linewidth=2, label=s)
    win = insider_window(con, args.user)
    style_axes(ax, f"Activité quotidienne — {args.user}")
    shade_window(ax, win)
    ax.legend(frameon=False, fontsize=8, labelcolor=INK)
    fig.autofmt_xdate(rotation=30)
    save(fig, f"timeline_{args.user}", {
        "tool": "user_timeline", "user": args.user,
        "days": int(df["day"].nunique()),
        "insider": bool(win), "window": win})


def usb_activity(con, args):
    """Branchements USB par jour, moyenne de l'utilisateur en repère."""
    df = daily(con, args.user, args.start, args.end)
    dev = df[df["stream"] == "device"]
    base = pd.read_sql(
        "SELECT DISTINCT mean_events, std_events FROM cert_daily_baseline "
        "WHERE [user]=? AND stream='device'", con, params=(args.user,))
    mean = float(base["mean_events"][0]) if len(base) else 0
    std = float(base["std_events"][0]) if len(base) else 0
    thresh = mean + 3 * std
    fig, ax = plt.subplots(figsize=(9, 4))
    colors = [CRITICAL if n > thresh else SERIES[0] for n in dev["n_events"]]
    ax.bar(dev["day"], dev["n_events"], color=colors, width=0.9)
    ax.axhline(mean, color=MUTED, linewidth=1, linestyle="--")
    ax.text(dev["day"].min() if len(dev) else 0, mean,
            f" moyenne {mean:.1f}", color=MUTED, fontsize=8, va="bottom")
    style_axes(ax, f"Branchements USB par jour — {args.user}")
    shade_window(ax, insider_window(con, args.user))
    anomalies = dev[dev["n_events"] > thresh]
    fig.autofmt_xdate(rotation=30)
    save(fig, f"usb_{args.user}", {
        "tool": "usb_activity", "user": args.user, "mean": round(mean, 2),
        "threshold_3sigma": round(thresh, 2),
        "anomalous_days": anomalies["day"].dt.strftime("%Y-%m-%d").tolist()})


def after_hours(con, args):
    """Top utilisateurs par connexions hors horaires (22h-6h)."""
    where, params = "", []
    if args.start:
        where += " AND date(substr(date,7,4)||'-'||substr(date,1,2)||'-'||substr(date,4,2)) >= ?"
        params.append(args.start)
    if args.end:
        where += " AND date(substr(date,7,4)||'-'||substr(date,1,2)||'-'||substr(date,4,2)) <= ?"
        params.append(args.end)
    df = pd.read_sql(
        "SELECT [user], COUNT(*) n FROM cert_logon "
        "WHERE activity='Logon' AND (CAST(substr(date,12,2) AS INT) >= 22 "
        f"OR CAST(substr(date,12,2) AS INT) < 6) {where} "
        "GROUP BY [user] ORDER BY n DESC LIMIT ?",
        con, params=(*params, args.top))
    insiders = {r[0] for r in con.execute(
        "SELECT [user] FROM cert_insiders WHERE dataset='4.2'")}
    fig, ax = plt.subplots(figsize=(8, 0.35 * len(df) + 1.5))
    colors = [CRITICAL if u in insiders else SERIES[0] for u in df["user"]]
    ax.barh(df["user"][::-1], df["n"][::-1],
            color=colors[::-1], height=0.7)
    style_axes(ax, "Connexions hors horaires (22h-6h) — top utilisateurs")
    ax.grid(True, axis="x", color=GRID, linewidth=0.6)
    ax.grid(False, axis="y")
    save(fig, "after_hours", {
        "tool": "after_hours", "top": df.to_dict("records"),
        "insiders_in_top": sorted(set(df["user"]) & insiders)})


def outliers(con, args):
    """Jours anormaux (> moyenne + sigma·écart-type) sur un flux."""
    df = pd.read_sql(
        "SELECT [user], day, n_events, mean_events, std_events "
        "FROM cert_daily_baseline WHERE stream=? "
        "AND n_events > mean_events + ? * std_events AND std_events > 0 "
        "ORDER BY day", con, params=(args.stream, args.sigma))
    df["day"] = pd.to_datetime(df["day"])
    if args.start:
        df = df[df["day"] >= pd.to_datetime(args.start)]
    if args.end:
        df = df[df["day"] <= pd.to_datetime(args.end)]
    perday = df.groupby("day").size()
    fig, ax = plt.subplots(figsize=(9, 4))
    ax.plot(perday.index, perday.values, color=SERIES[0], linewidth=2)
    style_axes(ax, f"Utilisateurs en anomalie par jour — flux {args.stream} "
                   f"(> {args.sigma}σ)")
    insiders = {r[0] for r in con.execute(
        "SELECT [user] FROM cert_insiders WHERE dataset='4.2'")}
    hits = sorted(set(df["user"]) & insiders)
    fig.autofmt_xdate(rotation=30)
    save(fig, f"outliers_{args.stream}", {
        "tool": "outliers", "stream": args.stream, "sigma": args.sigma,
        "anomalous_user_days": len(df),
        "distinct_users": int(df["user"].nunique()),
        "confirmed_insiders_flagged": hits})


def main():
    p = argparse.ArgumentParser()
    p.add_argument("tool", choices=["user_timeline", "usb_activity",
                                    "after_hours", "outliers"])
    p.add_argument("--user")
    p.add_argument("--start")
    p.add_argument("--end")
    p.add_argument("--top", type=int, default=15)
    p.add_argument("--stream", default="device")
    p.add_argument("--sigma", type=float, default=3.0)
    args = p.parse_args()
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    globals()[args.tool](con, args)


if __name__ == "__main__":
    main()
