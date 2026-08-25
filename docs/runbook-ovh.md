# Runbook — Qwen3.8-27B sur OVHcloud L40S

Variante OVHcloud du déploiement (référence Scaleway : `runbook.md`).
Cible : instance **l40s-90** (1× NVIDIA L40S 48 GB, 90 Go RAM, ~€1.40/h)
en région **GRA11**. Seules la phase 1 (provisionnement) et l'exploitation
diffèrent ; les phases 2-4 (vLLM, optimisations, recette) sont celles du
runbook Scaleway avec **un seul ajustement : retirer
`--tensor-parallel-size` (un seul GPU)**.

Bench mesuré 2026-08-25 : mono-requête + MTP k=2 **41,7 tok/s**
(vs 23-32 sur 2×L4), concurrence 16 **285 tok/s** (vs ~160), KV cache
251k tokens (vs 165k), acceptation MTP 0,88 en usage réel. Verdict :
moins cher ET plus rapide que 2×L4, ~2× de tokens par euro.

## Phase 0 — CLI et authentification

```bash
brew install ovhcloud          # ou voir https://github.com/ovh/ovhcloud-cli
# macOS : le binaire n'est pas notarisé, lever la quarantaine Gatekeeper :
xattr -d com.apple.quarantine "$(which ovhcloud)"
ovhcloud login                 # interactif, ouvre le navigateur
ovhcloud cloud project list    # doit lister le projet Public Cloud
```

**[V0]** `ovhcloud cloud project list` renvoie le projet, sans erreur.

## Phase 1 — Provisionnement

### 1a. Quota GPU (piège bloquant, vérifié)

Les flavors GPU exigent un quota RAM élevé. Un projet neuf plafonne
souvent à 44 Go en GRA11 (profil "8vms"), et la l40s-90 en demande 90.
Symptôme : `409 Conflict "ram quota 44000 reached"` à la création.

Augmenter dans le manager OVH → Public Cloud → projet → **Quota et
régions → Augmenter les quotas** pour GRA11 (le toggle "Quota
autoscaling" ne suffit PAS ; il faut un palier explicite ≥ 90 Go RAM).
Si non self-service, ouvrir un ticket support. La CLI `ovhcloud cloud
quota edit` est cassée à ce jour (renvoie un profil déprécié "limited"
pour une autre région et échoue en 400) — passer par le manager.

```bash
P=<project-id>
ovhcloud cloud quota get --cloud-project $P -o json \
  | jq -r '.currentState.regions[] | select(.location.region=="GRA11")
           | {profile, ram_limit: .usage.compute.memory.limit}'
# ram_limit doit être > 92160 (90 Go) avant de continuer
```

### 1b. Flavor et image

```bash
# flavor l40s-90 (colonne available=true en GRA11)
ovhcloud cloud instance flavor list --cloud-project $P | grep -i l40s-90
# image avec driver NVIDIA préinstallé (PAS de "GPU OS" comme Scaleway ;
# cette image fournit le driver, mais pas Docker ni le container-toolkit)
ovhcloud cloud instance image list --cloud-project $P -o json \
  | jq -r '.[] | select(.region=="GRA11" and .name=="Ubuntu 24.04 - NVIDIA - v580") | .id'
```

### 1c. Création avec cloud-init

Le cloud-init installe Docker + nvidia-container-toolkit (absents de
l'image, ~5 min au premier boot). Contenu de `ovh-userdata.sh` :

```bash
#!/bin/bash
set -e
apt-get update && apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" > /etc/apt/sources.list.d/docker.list
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -sL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' > /etc/apt/sources.list.d/nvidia-container-toolkit.list
apt-get update && apt-get install -y docker-ce docker-ce-cli containerd.io nvidia-container-toolkit
nvidia-ctk runtime configure --runtime=docker && systemctl restart docker
touch /root/.userdata-done
```

Création (passer la clé SSH **inline** — le référencement par nom
échoue avec "SSH key with this name is not found", vérifié) :

```bash
ovhcloud cloud instance create GRA11 --cloud-project $P \
  --name qwen38-l40s \
  --flavor <flavor-id-l40s-90> \
  --boot-from.image <image-id> \
  --ssh-key.create.name pierre-ed25519 \
  --ssh-key.create.public-key "$(cat ~/.ssh/id_ed25519.pub)" \
  --network.public \
  --user-data "$(cat ovh-userdata.sh)"
```

Pièges CLI vérifiés : la commande peut rester muette plusieurs minutes
avant une erreur (ajouter `-d` pour voir les requêtes HTTP). L'user SSH
est **`ubuntu`** (pas `root`), accès root via `sudo`.

**[V1]** GPU visible et Docker opérationnel :

```bash
IP=$(ovhcloud cloud instance list --cloud-project $P -o json | jq -r '.[0].ipAddresses[] | select(.version==4) | .ip')
ssh ubuntu@$IP 'nvidia-smi --query-gpu=name,memory.total --format=csv,noheader; sudo docker run --rm --gpus all ubuntu nvidia-smi -L'
# attendu : NVIDIA L40S, 46068 MiB ; et "GPU 0: NVIDIA L40S ..."
```

## Phases 2-4 — vLLM, optimisations, recette

Identiques au runbook Scaleway (`runbook.md`), avec :

- **retirer `--tensor-parallel-size 2`** (un seul GPU) ;
- exécuter les commandes docker via `sudo` (user `ubuntu`) ;
- premier `docker run` : le pull de l'image vLLM (~9 Go) peut dépasser
  un timeout SSH ; lancer en `-d` et suivre `sudo docker logs vllm`.

Commande vLLM complète validée sur L40S :

```bash
sudo docker run -d --name vllm --gpus all --restart unless-stopped \
  -p 8000:8000 -v /root/models:/root/.cache/huggingface --ipc=host \
  vllm/vllm-openai:latest \
  --model Qwen/Qwen3.8-27B-FP8 --max-model-len 32768 \
  --gpu-memory-utilization 0.93 --enable-prefix-caching --kv-cache-dtype fp8 \
  --limit-mm-per-prompt '{"image": 4, "video": 0}' --max-num-seqs 32 \
  --reasoning-parser qwen3 \
  --speculative-config '{"method":"mtp","num_speculative_tokens":2}' \
  --enable-auto-tool-choice --tool-call-parser qwen3_xml \
  --api-key $VLLM_API_KEY
```

Réseau : les instances Public Cloud OVH n'ont **pas** de security group
bloquant par défaut — les ports sont ouverts, rien à configurer côté
Scaleway-like. Protéger l'exposition par un reverse proxy TLS + auth
(Caddy), jamais le port applicatif nu.

## Phase 5 — Exploitation et arrêt (facturation)

**Attention, différent de Scaleway.** Un `stop` OVH (`shutoff`) **NE
suspend PAS la facturation** : l'instance reste facturée tant qu'elle
existe. Pour arrêter la facturation compute il faut **shelve** :

```bash
ovhcloud cloud instance shelve   <instance-id>   # suspend la facturation compute
#   → snapshot du disque local créé (seul le snapshot est facturé), IP conservée
ovhcloud cloud instance unshelve <instance-id>   # restaure, supprime le snapshot
ovhcloud cloud instance delete   <instance-id>   # destruction définitive
```

Risque à connaître : l'**unshelve d'un GPU exige un hôte L40S
disponible** dans la région. En période de tension, l'instance peut
rester bloquée shelved. Pour une machine rallumée souvent, Scaleway
(stop/start, même hôte) est opérationnellement plus sûr ; le shelve OVH
convient aux pauses longues.

## Comparatif L40S vs 2×L4 (mesuré 2026-08-25)

| | 2×L4 Scaleway (€1.575/h) | L40S OVH (€1.40/h) |
|---|---|---|
| Mono-requête + MTP | 23-32 tok/s | 41,7 tok/s |
| Concurrence 16 + MTP | ~160 tok/s | 285 tok/s |
| KV cache | 165k tokens | 251k tokens |
| Tokens/€ | référence | ~2× |
