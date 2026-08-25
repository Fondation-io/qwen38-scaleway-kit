#!/usr/bin/env bash
# Recette Qwen3.8-27B — exécute V2 + T1-T5 contre une instance déployée
# selon docs/operations/qwen38-27b-scaleway-runbook.md et produit un
# rapport markdown dans artifacts/.
#
# Usage: scripts/infra/qwen38-recette.sh <ip-instance> [rapport.md]
# Prérequis : accès SSH root@<ip>, /root/vllm.env présent sur l'instance,
# conteneur "vllm" démarré.
set -euo pipefail

IP="${1:?usage: qwen38-recette.sh <ip-instance> [rapport.md]}"
REPORT="${2:-artifacts/qwen38-recette-$(date +%Y%m%d-%H%M).md}"
MODEL="Qwen/Qwen3.8-27B-FP8"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=15 root@$IP"

mkdir -p "$(dirname "$REPORT")"

pass=0; fail=0
declare -a rows

check() { # check <id> <critere> <ok:0|1> <mesure>
  local id="$1" critere="$2" ok="$3" mesure="$4"
  if [ "$ok" = 0 ]; then rows+=("| $id | $critere | PASS | $mesure |"); pass=$((pass+1));
  else rows+=("| $id | $critere | **FAIL** | $mesure |"); fail=$((fail+1)); fi
  echo "[$id] $([ "$ok" = 0 ] && echo PASS || echo FAIL) — $mesure"
}

echo "== Recette $MODEL sur $IP =="

# --- V2 : API up + chat propre
V2=$($SSH 'source /root/vllm.env; curl -s http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer $VLLM_API_KEY" -H "Content-Type: application/json" \
  -d "{\"model\":\"'"$MODEL"'\",\"messages\":[{\"role\":\"user\",\"content\":\"Réponds uniquement: OK\"}],\"max_tokens\":20,\"chat_template_kwargs\":{\"enable_thinking\":false}}"' \
  | jq -r '.choices[0].message.content // "ERREUR"' | tr -d '[:space:]')
[ "$V2" = "OK" ]; check V2 "chat répond OK, content propre" $? "content='$V2'"

# --- T1 : débit mono-requête
T1=$($SSH 'source /root/vllm.env; docker exec -e OPENAI_API_KEY=$VLLM_API_KEY vllm vllm bench serve \
  --model '"$MODEL"' --host localhost --port 8000 \
  --dataset-name random --random-input-len 512 --random-output-len 512 \
  --num-prompts 4 --max-concurrency 1 2>&1' | grep "Output token throughput" | grep -oE '[0-9]+\.[0-9]+')
awk "BEGIN{exit !($T1 >= 22)}"; check T1 ">= 22 tok/s mono-requête (MTP)" $? "$T1 tok/s"

# --- T2 : débit concurrence 16
T2OUT=$($SSH 'source /root/vllm.env; docker exec -e OPENAI_API_KEY=$VLLM_API_KEY vllm vllm bench serve \
  --model '"$MODEL"' --host localhost --port 8000 \
  --dataset-name random --random-input-len 512 --random-output-len 256 \
  --num-prompts 64 --max-concurrency 16 2>&1')
T2=$(echo "$T2OUT" | grep "Output token throughput" | grep -oE '[0-9]+\.[0-9]+')
T2N=$(echo "$T2OUT" | grep "Successful requests" | grep -oE '[0-9]+')
awk "BEGIN{exit !($T2 >= 100 && $T2N == 64)}"; check T2 ">= 100 tok/s agrégés, 64/64 réussies" $? "$T2 tok/s, $T2N/64"

# --- T3 : contexte long 20k
T3=$($SSH 'python3 - <<PY
import json, urllib.request, time
key = open("/root/vllm.env").read().strip().split("=")[1]
body = {"model": "'"$MODEL"'",
        "messages": [{"role": "user", "content": "mot " * 20000 + "Combien de fois environ le mot mot apparait-il ? Un nombre seul."}],
        "max_tokens": 100, "chat_template_kwargs": {"enable_thinking": False}}
t0 = time.time()
req = urllib.request.Request("http://localhost:8000/v1/chat/completions",
    json.dumps(body).encode(), {"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
r = json.loads(urllib.request.urlopen(req, timeout=600).read())
ok = r["usage"]["prompt_tokens"] > 20000 and (r["choices"][0]["message"]["content"] or "").strip() != ""
print(("OK" if ok else "KO") + " prompt_tokens=%d duree=%.1fs" % (r["usage"]["prompt_tokens"], time.time()-t0))
PY')
echo "$T3" | grep -q '^OK'; check T3 "20k tokens ingérés, réponse non vide" $? "$T3"

# --- T4 : multimodal base64
T4=$($SSH 'curl -sL -o /tmp/recette-img.jpg "https://raw.githubusercontent.com/pytorch/hub/master/images/dog.jpg" && python3 - <<PY
import base64, json, urllib.request
key = open("/root/vllm.env").read().strip().split("=")[1]
b64 = base64.b64encode(open("/tmp/recette-img.jpg","rb").read()).decode()
body = {"model": "'"$MODEL"'",
        "messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
            {"type": "text", "text": "Quel animal ? Un mot."}]}],
        "max_tokens": 200, "chat_template_kwargs": {"enable_thinking": False}}
req = urllib.request.Request("http://localhost:8000/v1/chat/completions",
    json.dumps(body).encode(), {"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
r = json.loads(urllib.request.urlopen(req, timeout=300).read())
print((r["choices"][0]["message"]["content"] or "").strip()[:60])
PY')
echo "$T4" | grep -qiE 'chien|dog'; check T4 "image reconnue (chien)" $? "réponse='$T4'"

# --- T5 : VRAM stable, zéro OOM
T5=$($SSH 'nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits | tr "\n" "/" ; docker logs vllm 2>&1 | grep -ciE "out of memory|CUDA error" || true')
OOM=$(echo "$T5" | grep -oE '[0-9]+$')
[ "$OOM" = 0 ]; check T5 "0 OOM/CUDA error, VRAM stable" $? "used=$(echo "$T5" | grep -oE '^[0-9]+/[0-9]+') MiB, erreurs=$OOM"

# --- Acceptation MTP (informatif, non bloquant)
MTP=$($SSH 'curl -s localhost:8000/metrics | grep -E "spec_decode_num_(accepted|draft)_tokens_total" | grep -v "^#" | grep -oE "[0-9.]+$" | tr "\n" " "')
ACC=$(echo "$MTP" | awk '{if ($1+0 > 0) printf "%.2f", $2/$1; else print "n/a"}')

# --- Rapport
{
  echo "# Rapport de recette — $MODEL"
  echo
  echo "- Date : $(date '+%Y-%m-%d %H:%M %Z')"
  echo "- Instance : $IP"
  echo "- Opérateur : ${USER}@$(hostname -s) via qwen38-recette.sh"
  echo "- Config serveur : $($SSH 'docker inspect vllm --format "{{join .Args \" \"}}"' | sed 's/--api-key [^ ]*/--api-key ***/')"
  echo
  echo "## Résultats"
  echo
  echo "| Test | Critère | Verdict | Mesure |"
  echo "|------|---------|---------|--------|"
  printf '%s\n' "${rows[@]}"
  echo
  echo "## Indicateurs"
  echo
  echo "- Acceptation MTP (draft accepted) : ${MTP}- taux $ACC"
  echo "- Verdict global : $([ $fail = 0 ] && echo "**RECETTE PASSÉE** ($pass/$((pass+fail)))" || echo "**ÉCHEC** ($fail test(s) en échec)")"
} > "$REPORT"

echo
echo "Rapport : $REPORT — $([ $fail = 0 ] && echo "RECETTE PASSÉE ($pass/$((pass+fail)))" || echo "ÉCHEC ($fail KO)")"
exit $fail
