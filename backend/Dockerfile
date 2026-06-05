FROM python:3.12-slim

WORKDIR /app

# rasterio wheels bundle GDAL/PROJ, but some system libs (e.g. libexpat) are still needed (not in slim)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libexpat1 \
    && rm -rf /var/lib/apt/lists/*

# rasterio/titiler wheels bundle GDAL/PROJ -- no system GDAL needed
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# tile disk cache location (volume-mounted in compose)
ENV AEF_TILE_CACHE=/cache
RUN mkdir -p /cache

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
