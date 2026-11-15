# Single-service image: builds the React app, then serves it from the FastAPI
# backend. Build context is the repo root (see railway.toml).

# ---- Stage 1: frontend build ----
FROM node:22-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: backend + built frontend ----
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
# Default FRONTEND_DIST (../frontend/dist relative to backend/) resolves here.
COPY --from=frontend /build/frontend/dist ./frontend/dist

WORKDIR /app/backend

# Never set the test-mode switch here: it exposes state-injection routes.
ENV ENVIRONMENT=prod

EXPOSE 8000

# Railway injects PORT; default to 8000 locally.
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
