# Playbook agent — Qwen3.8-27B sur Scaleway L4-2-24G

Procédure exécutable par un agent (Claude ou équivalent) sans intervention
humaine. Version narrée pour humain avec explications :
`runbook.md`. Chaque étape donne la commande, la
sortie attendue et la branche d'échec. Exécuter séquentiellement, ne
jamais dépasser une étape en échec.

## Prérequis (seule intervention humaine)

Copier `.env.example` vers `.env`
(gitignored) et remplir les clés depuis
https://console.scaleway.com/iam/api-keys.
Une clé SSH du poste opérateur enregistrée dans l'IAM Scaleway.

## Étape 1 — Authentification

```bash
set -a; source .env; set +a
scw account project list
```

Attendu : liste de projets. Échec "No credentials provided" ou fichier
absent → `qwen38.env` manquant ou invalide, STOP, demander à l'humain.

## Étape 2 — Instance

```bash
scw instance server create zone=fr-par-2 type=L4-2-24G name=qwen38-27b \
  image=ubuntu_noble_gpu_os_13_nvidia root-volume=block:150GB ip=new
# noter <ID> dans la sortie
scw instance server start <ID> zone=fr-par-2 -w
IP=$(scw instance server get <ID> zone=fr-par-2 -o json | jq -r '.public_ips[0].address')
```

Échec "out of stock" → vérifier `scw instance server-type list
zone=fr-par-2 | grep L4`, STOP si indisponible.

## Étape 3 — Security group dédié

```bash
MY_IP=$(curl -4 -s ifconfig.me)   # -4 obligatoire, IPv6 rejeté en /32
scw instance security-group create zone=fr-par-2 name=qwen38-27b-sg \
  inbound-default-policy=drop outbound-default-policy=accept stateful=true
SG=$(scw instance security-group list zone=fr-par-2 -o json | jq -r '.[] | select(.name=="qwen38-27b-sg") | .id')
for p in 22 8000; do
  scw instance security-group create-rule security-group-id=$SG zone=fr-par-2 \
    direction=inbound action=accept protocol=TCP dest-port-from=$p ip-range=$MY_IP/32
done
scw instance server update <ID> zone=fr-par-2 security-group-id=$SG
```

Ne PAS modifier le security group "Default" : partagé avec d'autres
instances du projet.

## Étape 4 — Contrôle GPU

```bash
ssh -o StrictHostKeyChecking=accept-new root@$IP \
  'nvidia-smi --query-gpu=name --format=csv,noheader'
```

Attendu : deux lignes `NVIDIA L4`. Timeout SSH → attendre 60 s (boot),
réessayer 3 fois, puis STOP.

## Étape 5 — Déploiement vLLM (config finale validée 2026-08-25)

```bash
ssh root@$IP 'bash -s' <<'EOF'
VLLM_API_KEY=$(openssl rand -hex 24)
echo "VLLM_API_KEY=$VLLM_API_KEY" > /root/vllm.env && chmod 600 /root/vllm.env
docker run -d --name vllm --gpus all --restart unless-stopped \
  -p 8000:8000 -v /root/models:/root/.cache/huggingface --ipc=host \
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
  --speculative-config '{"method":"mtp","num_speculative_tokens":2}' \
  --api-key $VLLM_API_KEY
EOF
```

Tous les flags sont obligatoires, chacun corrige un incident vérifié
(détail dans le runbook humain, phase 2 et 3). Ne pas "simplifier".

Attendre le démarrage (premier run : ~28 GB à télécharger, 10-20 min ;
relance avec cache : ~7 min) :

```bash
# boucle : toutes les 60 s, max 30 min
ssh root@$IP 'docker logs vllm 2>&1 | grep -c "Application startup complete"'
```

`1` → continuer. Si `docker ps` montre le conteneur qui redémarre en
boucle (uptime retombant à zéro) → lire `docker logs vllm | grep Error`,
STOP avec le log.

## Étape 6 — Recette et rapport

Depuis la racine du kit, sur le poste opérateur :

```bash
scripts/qwen38-recette.sh $IP
```

Le script exécute V2 + T1-T5, écrit le rapport dans
`artifacts/qwen38-recette-<date>.md` et sort en code 0 si tout passe
(sinon code = nombre de tests en échec). Durée ~10 min. Livrer le rapport
à l'humain. Un test FAIL → ne pas déclarer l'installation validée.

## Étape 7 — Fin de session

Rappeler à l'humain : instance facturée ~€1.575/h. Arrêt :
`scw instance server stop <ID> zone=fr-par-2`. Le volume block reste
facturé (~€12/mois).
