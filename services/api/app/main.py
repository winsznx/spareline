from __future__ import annotations

import logging
import time
import uuid
from collections import defaultdict, deque

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routes import router
from app.config import SERVICE_VERSION, get_settings

logging.basicConfig(level=logging.INFO, format='{"ts":"%(asctime)s","lvl":"%(levelname)s","msg":"%(message)s"}')
log = logging.getLogger("spareline.api")
settings = get_settings()
MAX_BODY_BYTES = 16 * 1024

app = FastAPI(
    title="Spareline API",
    version=SERVICE_VERSION,
    description="Late-route rescue decisions on historical Amazon/MIT 2018 routes with simulated disruptions. "
    "Research replay; not a live dispatch system.",
    docs_url="/v1/docs",
    openapi_url="/v1/openapi.json",
    redoc_url=None,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins,
    allow_origin_regex=settings.allowed_origin_regex,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type", "X-Spareline-Session", "X-Request-ID"],
    expose_headers=["X-Request-ID", "Content-Disposition"],
    max_age=600,
)

_hits: dict[tuple[str, str], deque[float]] = defaultdict(deque)


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")


def _limited(ip: str, bucket: str, limit: int) -> bool:
    q, now = _hits[(ip, bucket)], time.monotonic()
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= limit:
        return True
    q.append(now)
    return False


def _error(status: int, code: str, message: str, request_id: str) -> JSONResponse:
    return JSONResponse(
        {"code": code, "message": message, "request_id": request_id},
        status_code=status,
        headers={"X-Request-ID": request_id},
    )


@app.middleware("http")
async def guard(request: Request, call_next):
    rid = request.headers.get("x-request-id", "")[:64] or uuid.uuid4().hex[:16]
    request.state.request_id = rid
    started = time.perf_counter()
    if request.method == "POST":
        length = request.headers.get("content-length")
        if length and int(length) > MAX_BODY_BYTES:
            return _error(413, "payload_too_large", "Request body is too large.", rid)
    if request.method != "OPTIONS" and not request.url.path.endswith(("/healthz", "/readyz")):
        ip = _client_ip(request)
        if _limited(ip, "all", settings.rate_limit_per_minute):
            return _error(429, "rate_limited", "Too many requests. Wait a minute and retry.", rid)
        if request.url.path.endswith("/run") and _limited(ip, "run", settings.run_rate_limit_per_minute):
            return _error(429, "rate_limited", "Optimization rate limit reached. Wait a minute and retry.", rid)
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Cache-Control"] = response.headers.get("Cache-Control", "no-store")
    log.info(
        f"{request.method} {request.url.path} {response.status_code} "
        f"{int((time.perf_counter() - started) * 1000)}ms rid={rid}"
    )
    return response


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail if isinstance(exc.detail, dict) else {"code": "http_error", "message": str(exc.detail)}
    return _error(
        exc.status_code, detail.get("code", "http_error"), detail.get("message", ""), request.state.request_id
    )


@app.exception_handler(RequestValidationError)
async def validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
    first = exc.errors()[0] if exc.errors() else {}
    loc = ".".join(str(x) for x in first.get("loc", []) if x != "body")
    return _error(422, "invalid_input", f"{loc}: {first.get('msg', 'invalid')}".strip(": "), request.state.request_id)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception) -> JSONResponse:
    log.exception(f"unhandled rid={request.state.request_id}")
    return _error(500, "internal_error", "The request could not be completed.", request.state.request_id)


app.include_router(router)
