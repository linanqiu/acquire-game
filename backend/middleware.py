"""HTTP middleware for the Acquire application."""

import time
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from logging_config import get_logger, request_id_var

logger = get_logger(__name__)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """Middleware that adds request ID tracking and request/response logging.

    For each HTTP request:
    - Generates a unique request ID (UUID4)
    - Sets the request_id ContextVar for downstream log correlation
    - Logs the incoming request method and path
    - Logs the response status code and duration
    - Adds X-Request-ID header to the response
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = str(uuid.uuid4())
        request_id_var.set(request_id)

        method = request.method
        path = request.url.path

        logger.info("Request started: %s %s", method, path)

        start_time = time.perf_counter()

        try:
            response = await call_next(request)
        except Exception:
            duration_ms = (time.perf_counter() - start_time) * 1000
            logger.exception(
                "Request failed: %s %s (%.1fms)", method, path, duration_ms
            )
            raise

        duration_ms = (time.perf_counter() - start_time) * 1000

        logger.info(
            "Request completed: %s %s -> %d (%.1fms)",
            method,
            path,
            response.status_code,
            duration_ms,
        )

        response.headers["X-Request-ID"] = request_id

        return response
