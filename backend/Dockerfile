# Build stage
FROM python:3.12-slim AS builder

WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Runtime stage — minimal image, non-root user
FROM python:3.12-slim

RUN addgroup --system syswarden && adduser --system --ingroup syswarden syswarden

WORKDIR /app

COPY --from=builder /install /usr/local
COPY app/ ./app/
COPY entrypoint.py /entrypoint.py

# Data volume for SQLite file
RUN mkdir -p /app/data && chown syswarden:syswarden /app/data

EXPOSE 8000

# Entrypoint runs as root, chowns the bind-mount dir if needed, then drops to syswarden.
# This handles Docker auto-creating ./data as root on first run.
ENTRYPOINT ["python3", "/entrypoint.py"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
