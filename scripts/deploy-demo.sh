#!/usr/bin/env bash
# Déploiement de la démo chatbot sur l'instance Scaleway du kit.
#
# Build l'image Docker (linux/amd64), la pousse sur GHCR, puis sur
# l'instance : pull, construction one-shot de la base SQLite dans le
# volume /root/demo-data (première fois seulement, ~45 min), démarrage
# de l'app en --network host (vLLM en localhost), vérification.
#
# Usage:   scripts/deploy-demo.sh <ip-instance> [--skip-build] [--skip-db]
# Prérequis poste opérateur : docker buildx, gh CLI authentifiée (scope
# write:packages ou un GHCR_TOKEN exporté), accès SSH root@<ip>.
set -euo pipefail

IP="${1:?usage: deploy-demo.sh <ip-instance> [--skip-build] [--skip-db]}"
shift
SKIP_BUILD=0; SKIP_DB=0
for a in "$@"; do
  [ "$a" = "--skip-build" ] && SKIP_BUILD=1
  [ "$a" = "--skip-db" ] && SKIP_DB=1
done

KIT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="ghcr.io/fondation-io/qwen38-demo:latest"
SSH="ssh -o BatchMode=yes root@$IP"

# --- 1. build + push (multi-arch inutile : cible unique amd64) ---
if [ "$SKIP_BUILD" = 0 ]; then
  echo "== Build $IMAGE =="
  # les scripts du lab entrent dans le contexte docker via un staging
  rm -rf "$KIT/demo/lab-scripts" && mkdir -p "$KIT/demo/lab-scripts"
  cp "$KIT"/lab/scripts/*.py "$KIT/demo/lab-scripts/"
  TOKEN="${GHCR_TOKEN:-$(gh auth token)}"
  echo "$TOKEN" | docker login ghcr.io -u "$(gh api user -q .login)" --password-stdin
  docker buildx build --platform linux/amd64 --push \
    -t "$IMAGE" "$KIT/demo"
  rm -rf "$KIT/demo/lab-scripts"
fi

# --- 2. env de production sur l'instance ---
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

# --- 3. pull + base de données (one-shot si absente) ---
$SSH "docker pull $IMAGE"
if [ "$SKIP_DB" = 0 ]; then
  if ! $SSH 'test -f /root/demo-data/security-events.sqlite'; then
    echo "== Construction de la base (~45 min, one-shot) =="
    $SSH "docker run --rm --env-file /root/demo.env \
      -v /root/demo-data:/data -v /root/kagglehub-cache:/root/.cache/kagglehub \
      $IMAGE /opt/venv/bin/python /opt/lab/scripts/build_db.py all" \
      | grep -vE 'lignes( gardées)?$|^  profil'
  else
    echo "== Base déjà présente, conservée =="
  fi
fi

# --- 4. démarrage de l'app ---
echo "== Démarrage app =="
$SSH "docker rm -f qwen38-demo 2>/dev/null; docker run -d --name qwen38-demo \
  --restart unless-stopped --network host \
  --env-file /root/demo.env -v /root/demo-data:/data $IMAGE"

# --- 5. vérification ---
sleep 5
CODE=$($SSH 'curl -s -o /dev/null -w "%{http_code}" http://localhost:3000')
echo "HTTP local: $CODE"
[ "$CODE" = 200 ] || { echo "ECHEC: app ne répond pas"; $SSH 'docker logs qwen38-demo | tail -20'; exit 1; }
echo "OK — app servie sur http://$IP:3000 (accès restreint par security group)."
echo "Ouvrir le port 3000 aux IPs voulues : scw instance security-group ..."
