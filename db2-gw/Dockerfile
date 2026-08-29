# Debian slim : la wheel ibm_db embarque le clidriver (glibc requis, pas d'Alpine).
FROM python:3.11-slim

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libxml2 && \
    rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY service.py .

EXPOSE 8000
# 2 workers suffisent (démo) ; threads pour les requêtes lentes.
CMD ["gunicorn", "-w", "2", "--threads", "4", "-b", "0.0.0.0:8000", "service:app"]
