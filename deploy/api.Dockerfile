FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv
WORKDIR /srv/spareline/services/api
COPY services/api/pyproject.toml services/api/uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY services/api/app ./app
COPY services/api/migrations ./migrations
COPY services/api/scripts ./scripts
COPY data/processed /srv/spareline/data/processed
COPY evaluations /srv/spareline/evaluations
RUN useradd --system --uid 10010 spareline && chown -R spareline /srv/spareline
USER spareline
ENV PATH="/srv/spareline/services/api/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*", "--no-access-log"]
