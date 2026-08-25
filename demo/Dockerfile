# Image de la démo : app Next.js (standalone) + runtime Python des
# graphiques. La base SQLite N'EST PAS dans l'image : volume /data,
# construite sur place (voir scripts/deploy-demo.sh du kit).
#
# Env attendues au run : VLLM_BASE_URL, VLLM_API_KEY, VLLM_MODEL,
# DB_PATH=/data/security-events.sqlite, PYTHON_BIN=/opt/venv/bin/python,
# CHARTS_SCRIPT=/opt/lab/scripts/charts.py, CHARTS_OUT=/data/output

# --- build Next ---
FROM node:24-slim AS build
WORKDIR /app
RUN npm install -g bun
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

# --- runtime ---
FROM node:24-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-venv && rm -rf /var/lib/apt/lists/*
# venv graphiques + ingestion (kagglehub sert au one-shot build-db)
RUN python3 -m venv /opt/venv && /opt/venv/bin/pip install --no-cache-dir \
    matplotlib pandas kagglehub
# scripts du lab (copiés depuis le contexte parent via deploy-demo.sh)
COPY lab-scripts/ /opt/lab/scripts/
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
EXPOSE 3000
CMD ["node", "server.js"]
