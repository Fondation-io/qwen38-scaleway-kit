#!/usr/bin/env bash
# Déploiement de la démo chatbot sur l'instance Scaleway du kit.
#
# L'image est buildée par GitHub Actions (.github/workflows/build-demo.yml,
# amd64 natif, push sur ghcr.io/fondation-io/qwen38-demo:latest à chaque
# push sur main touchant demo/). Ce script ne builde rien : il synchronise
# la base, tire l'image et démarre l'app.
#
# Usage:   scripts/deploy-demo.sh <ip-instance> [--build-db]
#   --build-db : reconstruit la base sur l'instance (~45 min) au lieu de
#                la rsync-er depuis le poste (fallback si pas de base
#                locale ; la base locale se construit avec
#                lab/scripts/build_db.py all).
# Prérequis : accès SSH root@<ip> ; base locale lab/data/security-events.sqlite
# sauf si --build-db.
set -euo pipefail

IP="${1:?usage: deploy-demo.sh <ip-instance> [--build-db]}"
BUILD_DB=0; [ "${2:-}" = "--build-db" ] && BUILD_DB=1

KIT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="ghcr.io/fondation-io/qwen38-demo:latest"
SSH="ssh -o BatchMode=yes root@$IP"

# --- 1. env de production sur l'instance ---
echo "== Env production =="
$SSH 'bash -s' <<'EOF'
set -e
mkdir -p /root/demo-data/output
if [ ! -f /root/demo.env ]; then
  source /root/vllm.env
  cat > /root/demo.env <<ENV
VLLM_BASE_URL=http://localhost:8000/v1
VLLM_API_KEY=$VLLM_API_KEY
VLLM_MODEL=Qwen/Qwen3.8-27B-FP8
DB_PATH=/data/security-events.sqlite
PYTHON_BIN=/opt/venv/bin/python
CHARTS_SCRIPT=/opt/lab/scripts/charts.py
CHARTS_OUT=/data/output
ENV
  chmod 600 /root/demo.env
fi
EOF

# --- 2. base de données ---
if ! $SSH 'test -f /root/demo-data/security-events.sqlite'; then
  if [ "$BUILD_DB" = 1 ]; then
    echo "== Construction de la base sur l'instance (~45 min) =="
    $SSH "docker run --rm --env-file /root/demo.env \
      -v /root/demo-data:/data -v /root/kagglehub-cache:/root/.cache/kagglehub \
      $IMAGE /opt/venv/bin/python /opt/lab/scripts/build_db.py all" \
      | grep -vE 'lignes( gardées)?$|^  profil'
  else
    echo "== Rsync de la base locale (7,6 GB) =="
    rsync -a --partial \
      "$KIT/lab/data/security-events.sqlite" "root@$IP:/root/demo-data/"
  fi
else
  echo "== Base déjà présente, conservée =="
fi

# --- 3. pull + démarrage ---
echo "== Pull + démarrage =="
$SSH "docker pull $IMAGE && docker rm -f qwen38-demo 2>/dev/null; \
  docker run -d --name qwen38-demo --restart unless-stopped --network host \
  --env-file /root/demo.env -v /root/demo-data:/data $IMAGE"

# --- 4. vérification ---
sleep 5
CODE=$($SSH 'curl -s -o /dev/null -w "%{http_code}" http://localhost:3000')
echo "HTTP local: $CODE"
[ "$CODE" = 200 ] || { echo "ECHEC: app ne répond pas"; $SSH 'docker logs qwen38-demo 2>&1 | tail -20'; exit 1; }
echo "OK — app sur http://$IP:3000 (accès restreint par security group)."
