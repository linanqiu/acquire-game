# =============================================================================
# Stage 1: Build the frontend (React + TypeScript + Vite)
# =============================================================================
FROM node:22-slim AS frontend-build

WORKDIR /build

# Install dependencies first for better layer caching
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

# Build the production bundle (tsc -b && vite build -> dist/)
COPY frontend/ ./
RUN npm run build

# =============================================================================
# Stage 2: Python backend + built frontend assets (single container)
# =============================================================================
FROM python:3.12-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY backend/ ./backend/

# Copy built frontend assets from stage 1
COPY --from=frontend-build /build/dist /app/static

# Tell the backend where the SPA bundle lives (see backend/main.py)
ENV STATIC_DIR=/app/static

WORKDIR /app/backend

# Expose port (hosting providers inject PORT env var)
EXPOSE 8000

# Run the application - use PORT env var from the platform, default to 8000
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
