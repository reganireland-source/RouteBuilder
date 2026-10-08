FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt requirements-nlp.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-nlp.txt

# Copy only what the service needs at runtime (docker:S6470 — a recursive
# `COPY . .` can sweep .env files, local certificates, __pycache__ or ad-hoc
# scratch files sitting in the working tree into the image). The ops scripts
# (add_waypoints.py, dump_postgres_to_json.py, populate_capabilities.py) and the
# test suite are deliberately NOT shipped: they are developer tooling and only
# widen the runtime surface. .dockerignore is a backstop, not a substitute.
COPY app ./app
COPY data ./data

# Run as an unprivileged user; the data dir must stay writable for the
# JSON-file storage mode and the dump-to-json admin endpoint.
RUN useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app/data
USER appuser

EXPOSE 8000

CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
