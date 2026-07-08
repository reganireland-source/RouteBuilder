FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt requirements-nlp.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-nlp.txt

COPY . .

# Run as an unprivileged user; the data dir must stay writable for the
# JSON-file storage mode and the dump-to-json admin endpoint.
RUN useradd --create-home --uid 10001 appuser \
    && chown -R appuser:appuser /app/data
USER appuser

EXPOSE 8000

CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
