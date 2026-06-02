# rasterio/titiler import 이전에 PROJ/GDAL 데이터 경로를 바로잡는다(윈도우 충돌 회피).
from . import _env  # noqa: F401  (부수효과 import — 가장 먼저)
