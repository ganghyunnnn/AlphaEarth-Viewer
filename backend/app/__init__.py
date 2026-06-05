# Fix PROJ/GDAL data paths before importing rasterio/titiler (avoids Windows conflicts).
from . import _env  # noqa: F401  (side-effect import — must come first)
