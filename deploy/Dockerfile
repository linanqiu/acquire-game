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

WORKDIR /app/backend

# Expose port (Railway uses PORT env var)
EXPOSE 8000

# Run the application - use PORT env var from Railway, default to 8000
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}
