FROM python:3.12-slim

WORKDIR /app

# rasterio 휠은 GDAL/PROJ를 번들하지만 libexpat 등 일부 시스템 lib는 필요(slim 미포함)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libexpat1 \
    && rm -rf /var/lib/apt/lists/*

# rasterio/titiler 휠은 GDAL/PROJ 번들 포함 — 시스템 GDAL 불필요
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# 타일 디스크 캐시 위치(컴포즈에서 볼륨 마운트)
ENV AEF_TILE_CACHE=/cache
RUN mkdir -p /cache

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
