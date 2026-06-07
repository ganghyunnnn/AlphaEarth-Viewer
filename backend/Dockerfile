FROM python:3.12-slim

WORKDIR /app

# rasterio wheels bundle GDAL/PROJ, but some system libs (e.g. libexpat) are still needed (not in slim)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libexpat1 \
    && rm -rf /var/lib/apt/lists/*

# uv for fast, locked dependency installs
COPY --from=ghcr.io/astral-sh/uv:0.9.4 /uv /uvx /bin/

# install locked deps first (cached layer); rasterio/titiler wheels bundle GDAL/PROJ -- no system GDAL needed
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

COPY app ./app

# tile disk cache location (volume-mounted in compose)
ENV AEF_TILE_CACHE=/cache
RUN mkdir -p /cache

# run from the uv-managed virtualenv
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
