# Runbook — Qwen3.8-27B sur Scaleway L4-2-24G

Déploiement, optimisation et recette d'un serveur d'inférence vLLM pour
`Qwen/Qwen3.8-27B-FP8` sur une instance Scaleway L4-2-24G (2× NVIDIA L4,
48 GB VRAM, ~€1.575/h facturée à la minute).

Public : partenaire technique. Prérequis : accès IAM Scaleway, terminal
macOS/Linux, aucune connaissance vLLM préalable. Chaque phase se termine
par une vérification `[Vn]`. Ne pas passer à la phase suivante tant que
la vérification échoue.

Variantes de ce document :
- exécution par un agent (Claude) : `agent-playbook.md` ;
- recette automatisée avec rapport : `scripts/qwen38-recette.sh <ip>`
  (exécute V2 + T1-T5, rapport dans `artifacts/`, code retour 0 si tout
  passe) — remplace le déroulé manuel de la phase 4 ci-dessous.

## Phase 0 — Prérequis et authentification

```bash
# CLI Scaleway
brew install scw          # macOS ; Linux : https://cli.scaleway.com
scw version               # attendu >= 2.58

# Authentification : copier le template de secrets puis le remplir
# (clés API : https://console.scaleway.com/iam/api-keys)
cp .env.example .env
# éditer .env, puis charger :
set -a; source .env; set +a
# Alternative interactive (ouvre le navigateur) : scw login
```

Ne jamais commiter `qwen38.env` (gitignored) ni coller les clés dans un
document ou un chat.

**[V0]** `scw account project list` renvoie au moins un projet, sans erreur
"No credentials provided".

## Phase 1 — Provisionnement de l'instance

Les L4 sont disponibles en `fr-par-2`. Vérifier le type exact et l'image GPU :

```bash
scw instance server-type list zone=fr-par-2 | grep -i l4
scw marketplace image list | grep -i "gpu os"
```

Créer l'instance (label vérifié au premier déroulé, 2026-08-25 :
`ubuntu_noble_gpu_os_13_nvidia`, Ubuntu 24.04 + driver 580) :

```bash
scw instance server create \
  zone=fr-par-2 \
  type=L4-2-24G \
  name=qwen38-27b \
  image=ubuntu_noble_gpu_os_13_nvidia \
  root-volume=block:150GB \
  ip=new
scw instance server start <id> zone=fr-par-2 -w
```

150 GB : les poids FP8 pèsent ~28 GB, plus l'image Docker vLLM (~10 GB)
et la marge pour un éventuel second checkpoint (draft spéculatif, 4-bit).

Restreindre l'accès réseau — ne jamais exposer le port 8000 en clair.
Créer un security group dédié (ne pas durcir le SG par défaut : il est
partagé avec les autres instances du projet). Pièges vérifiés :
`ip-range` exige un préfixe valide (IPv4 `/32`, IPv6 `/64` — un `/32`
IPv6 est rejeté avec "has host bits set"), et `curl ifconfig.me` peut
renvoyer l'IPv6 : forcer `curl -4`.

```bash
MY_IP=$(curl -4 -s ifconfig.me)
scw instance security-group create zone=fr-par-2 name=qwen38-27b-sg \
  inbound-default-policy=drop outbound-default-policy=accept stateful=true
SG_ID=$(scw instance security-group list zone=fr-par-2 -o json | jq -r '.[] | select(.name=="qwen38-27b-sg") | .id')
scw instance security-group create-rule security-group-id=$SG_ID zone=fr-par-2 \
  direction=inbound action=accept protocol=TCP dest-port-from=22 ip-range=$MY_IP/32
scw instance security-group create-rule security-group-id=$SG_ID zone=fr-par-2 \
  direction=inbound action=accept protocol=TCP dest-port-from=8000 ip-range=$MY_IP/32
scw instance server update <id> zone=fr-par-2 security-group-id=$SG_ID
```

**[V1]** SSH fonctionne et les 2 GPU sont visibles :

```bash
IP=$(scw instance server list zone=fr-par-2 name=qwen38-27b -o json | jq -r '.[0].public_ip.address')
ssh root@$IP nvidia-smi
# attendu : 2× "NVIDIA L4", driver chargé, 0 process
```

## Phase 2 — Déploiement vLLM

Sur l'instance (`ssh root@$IP`) :

```bash
# Clé d'API du serveur d'inférence — générer et NOTER cette valeur
export VLLM_API_KEY=$(openssl rand -hex 24)
echo "VLLM_API_KEY=$VLLM_API_KEY" > /root/vllm.env
chmod 600 /root/vllm.env

docker run -d --name vllm --gpus all --restart unless-stopped \
  --env-file /root/vllm.env \
  -p 8000:8000 \
  -v /root/models:/root/.cache/huggingface \
  --ipc=host \
  vllm/vllm-openai:latest \
  --model Qwen/Qwen3.8-27B-FP8 \
  --tensor-parallel-size 2 \
  --max-model-len 32768 \
  --gpu-memory-utilization 0.93 \
  --enable-prefix-caching \
  --kv-cache-dtype fp8 \
  --limit-mm-per-prompt '{"image": 4, "video": 0}' \
  --max-num-seqs 32 \
  --reasoning-parser qwen3 \
  --api-key $VLLM_API_KEY
```

`--limit-mm-per-prompt '{"image": 4, "video": 0}'` est OBLIGATOIRE sur
24 GB/GPU : le modèle est multimodal et, sans cette borne, vLLM
provisionne au démarrage la mémoire pour des entrées vidéo maximales et
crash-loop avec `ValueError: No available memory for the cache blocks`
(vérifié au premier déroulé, 2026-08-25).

`--reasoning-parser qwen3` est également requis : le modèle raisonne par
défaut et, sans parser, le raisonnement fuit dans `content` avec un
marqueur `</think>` brut au lieu d'être séparé dans `reasoning_content`.
Pour désactiver le raisonnement sur une requête donnée :
`"chat_template_kwargs": {"enable_thinking": false}` (vérifié).

Premier démarrage : ~28 GB de téléchargement puis chargement, compter
10-20 minutes. Suivre avec `docker logs -f vllm` jusqu'à
`Application startup complete`.

**[V2]** Depuis l'instance :

```bash
source /root/vllm.env
curl -s http://localhost:8000/v1/models -H "Authorization: Bearer $VLLM_API_KEY" | jq .
# attendu : "Qwen/Qwen3.8-27B-FP8" dans la liste
curl -s http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer $VLLM_API_KEY" -H "Content-Type: application/json" \
  -d '{"model":"Qwen/Qwen3.8-27B-FP8","messages":[{"role":"user","content":"Réponds uniquement: OK"}],"max_tokens":10}' | jq -r '.choices[0].message.content'
# attendu : OK
```

## Phase 3 — Optimisations

Appliquées dans l'ordre. O2 est déjà dans la commande de la phase 2.

| Code | Levier | Gain attendu | Coût |
|------|--------|--------------|------|
| O1 | Décodage spéculatif MTP/DFlash 2 | 1,7× à 3,4× tok/s mono-requête | ~1-2 GB VRAM |
| O2 | KV cache FP8 (`--kv-cache-dtype fp8`) | 2× capacité KV, débit agrégé | négligeable |
| O3 | Spéculatif n-gram | 1,5-2× sur code/RAG, rien sur texte libre | zéro |
| O4 | Quantization W4A16 | ~1,7× tok/s, tient sur 1× L4 | perte qualité à bencher |
| O5 | `--max-num-seqs` / `--max-num-batched-tokens` | débit agrégé sous trafic | zéro |

O1 — le drafteur MTP est intégré au checkpoint (pas de modèle séparé à
télécharger). Requiert vLLM >= 0.17. Ajouter à la commande docker :

```bash
--speculative-config '{"method": "mtp", "num_speculative_tokens": 2}'
```

`num_speculative_tokens: 2` est le réglage mesuré optimal sur L4
(2026-08-25) : 22,97 tok/s random / 24,1 tok/s sur prompt réel,
acceptation 0,54. Avec k=3, l'acceptation tombe à 0,28 et le débit à
19,44 tok/s — vLLM rejoue la même couche MTP à chaque position
supplémentaire, ce qui dégrade les drafts (warning explicite au
démarrage). Référence sans MTP : 14,69 tok/s.

Vérifier que le drafteur travaille réellement via le taux d'acceptation
(le débit seul ne distingue pas un drafteur actif d'un drafteur chargé
mais ignoré) :

```bash
curl -s localhost:8000/metrics | grep -E "spec_decode_num_(accepted|draft)_tokens_total"
# acceptation attendue ~0.77-0.79 avec KV cache FP8
```

L'alternative DFlash 2 (draft `incoai/Qwen3.8-27B-DFlash2`, jusqu'à 3,4×)
exige un build vLLM spécifique (PR #52816) — pas dans l'image standard,
non retenue ici.

O3 — variante sans VRAM supplémentaire si O1 indisponible :

```bash
--speculative-config '{"method": "ngram", "num_speculative_tokens": 4, "prompt_lookup_max": 4}'
```

Pour appliquer un changement de flags : `docker rm -f vllm` puis relancer
la commande de la phase 2 avec les flags ajoutés (les poids sont en cache
dans /root/models, redémarrage ~2-3 min).

**[V3]** `docker logs vllm 2>&1 | grep -i speculative` confirme la config
active, et [V2] repasse.

## Phase 4 — Recette (tests)

Depuis l'instance. Le bench officiel vLLM est inclus dans l'image :

```bash
source /root/vllm.env
# Piège vérifié : sans OPENAI_API_KEY, le bench prend des 401 et affiche
# "Successful requests: 0" sans message d'erreur explicite.

# T1 — latence mono-requête (débit génération)
docker exec -e OPENAI_API_KEY=$VLLM_API_KEY vllm vllm bench serve \
  --model Qwen/Qwen3.8-27B-FP8 --host localhost --port 8000 \
  --dataset-name random --random-input-len 512 --random-output-len 512 \
  --num-prompts 4 --max-concurrency 1
# Critère : output throughput >= 12 tok/s sans O1, >= 25 tok/s avec O1

# T2 — débit sous concurrence
docker exec -e OPENAI_API_KEY=$VLLM_API_KEY vllm vllm bench serve \
  --model Qwen/Qwen3.8-27B-FP8 --host localhost --port 8000 \
  --dataset-name random --random-input-len 512 --random-output-len 256 \
  --num-prompts 64 --max-concurrency 16
# Critère : aucun échec de requête, débit agrégé >= 100 tok/s

# T3 — contexte long
python3 - <<'EOF'
import json, urllib.request, os
key = open('/root/vllm.env').read().strip().split('=')[1]
body = {"model": "Qwen/Qwen3.8-27B-FP8",
        "messages": [{"role": "user", "content": "mot " * 20000 + "\nCombien de fois le mot 'mot' apparait-il environ ? Réponds en un chiffre."}],
        "max_tokens": 100, "chat_template_kwargs": {"enable_thinking": False}}
req = urllib.request.Request("http://localhost:8000/v1/chat/completions",
    json.dumps(body).encode(), {"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
print(json.loads(urllib.request.urlopen(req, timeout=300).read())["choices"][0]["message"]["content"])
EOF
# Critère : réponse cohérente, pas d'erreur de contexte

# T4 — multimodal (le modèle accepte les images)
# Piège vérifié : les URLs externes peuvent être refusées côté source
# (403 Wikimedia sur le user-agent du serveur) — passer l'image en
# base64. Le JSON se construit en Python : le base64 dépasse la limite
# d'arguments shell de jq.
curl -sL -o /tmp/test.jpg "https://raw.githubusercontent.com/pytorch/hub/master/images/dog.jpg"
python3 - <<'PY'
import base64, json
b64 = base64.b64encode(open('/tmp/test.jpg','rb').read()).decode()
req = {"model": "Qwen/Qwen3.8-27B-FP8",
       "messages": [{"role": "user", "content": [
           {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}},
           {"type": "text", "text": "Décris cette image en une phrase."}]}],
       "max_tokens": 500, "chat_template_kwargs": {"enable_thinking": False}}
json.dump(req, open('/tmp/req.json','w'))
PY
curl -s http://localhost:8000/v1/chat/completions \
  -H "Authorization: Bearer $VLLM_API_KEY" -H "Content-Type: application/json" \
  -d @/tmp/req.json | jq -r '.choices[0].message.content'
# Critère : description pertinente de l'image (un chien blanc sur pelouse)

# T5 — stabilité VRAM
nvidia-smi --query-gpu=memory.used,memory.total --format=csv
# Critère : usage stable (~22 GB / 24 GB par GPU), pas d'OOM dans docker logs vllm
```

**[V4]** T1 à T5 passent. Consigner les chiffres T1/T2 dans le tableau de
recette ci-dessous.

| Test | Critère | Mesuré | Date | Opérateur |
|------|---------|--------|------|-----------|
| T1 | ≥ 12 tok/s (≥ 22 avec O1) | 14,69 tok/s sans O1 ; 22,97 tok/s (24,1 sur prompt réel) avec O1 k=2 | 2026-08-25 | Claude (session Pierre) |
| T2 | ≥ 100 tok/s agrégé, 0 échec | 157,83 tok/s, 64/64 réussies, TTFT 2,19 s | 2026-08-25 | Claude (session Pierre) |
| T3 | réponse cohérente 20k tokens | 20 038 tokens de prompt, réponse en 11,9 s, pas d'erreur | 2026-08-25 | Claude (session Pierre) |
| T4 | description image correcte | image base64 décrite correctement | 2026-08-25 | Claude (session Pierre) |
| T5 | VRAM stable, 0 OOM | 20,0/23,0 GiB par GPU, 0 OOM | 2026-08-25 | Claude (session Pierre) |

Notes du premier déroulé (2026-08-25) :
- T3 : envoyer la requête avec `"chat_template_kwargs": {"enable_thinking": false}`,
  sinon le budget `max_tokens` part en raisonnement et `content` revient null.
- KV cache constaté : 3,28 GiB par GPU, 165 053 tokens (≈ 5 requêtes 32k
  simultanées).

## Phase 5 — Exploitation

```bash
docker logs -f vllm                           # logs
docker restart vllm                           # redémarrage (poids en cache)
curl -s localhost:8000/metrics | head         # métriques Prometheus
scw instance server stop <id> zone=fr-par-2   # arrêt (stoppe la facturation compute)
scw instance server start <id> zone=fr-par-2  # reprise
```

L'instance facture à la minute : arrêter hors usage. Le volume block
(150 GB) reste facturé même instance arrêtée (~€12/mois).

## Phase 6 — Démantèlement

```bash
scw instance server terminate <id> zone=fr-par-2 with-ip=true with-block=true
```

## Points non figés (à valider au premier déroulé)

- Nom du checkpoint draft MTP/DFlash 2 officiel et version vLLM minimale
  pour Qwen3.8-27B : https://recipes.vllm.ai/Qwen/Qwen3.8-27B, phase 3.
- Syntaxe `bench serve` selon la version vLLM embarquée dans l'image
  (`docker exec vllm python3 -m vllm.entrypoints.cli.main bench serve --help`), phase 4.
- Seuils T1/T2 : premières valeurs indicatives, à recaler après le
  premier passage et à figer dans le tableau de recette.
