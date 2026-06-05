"""Simple in-memory (LRU) + disk tile cache.

A cold tile render (remote COG read) takes several seconds, so identical
(z/x/y/band/contrast/year) requests are answered instantly from the cache.
In production the canonical approach is to put a CDN in front of this.
"""

from __future__ import annotations

import hashlib
import os
import threading
from collections import OrderedDict
from typing import Optional


class TileCache:
    def __init__(self, mem_max: int = 1024, disk_dir: Optional[str] = None):
        self._mem: "OrderedDict[str, bytes]" = OrderedDict()
        self._mem_max = mem_max
        self._lock = threading.Lock()
        self._disk_dir = disk_dir
        if disk_dir:
            os.makedirs(disk_dir, exist_ok=True)

    @staticmethod
    def key(*parts) -> str:
        return hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()

    def get(self, key: str) -> Optional[bytes]:
        with self._lock:
            data = self._mem.get(key)
            if data is not None:
                self._mem.move_to_end(key)
                return data
        if self._disk_dir:
            p = os.path.join(self._disk_dir, key + ".png")
            if os.path.exists(p):
                with open(p, "rb") as f:
                    data = f.read()
                self._mem_put(key, data)
                return data
        return None

    def put(self, key: str, data: bytes) -> None:
        self._mem_put(key, data)
        if self._disk_dir:
            p = os.path.join(self._disk_dir, key + ".png")
            tmp = p + ".tmp"
            with open(tmp, "wb") as f:
                f.write(data)
            os.replace(tmp, p)  # atomic replace

    def _mem_put(self, key: str, data: bytes) -> None:
        with self._lock:
            self._mem[key] = data
            self._mem.move_to_end(key)
            while len(self._mem) > self._mem_max:
                self._mem.popitem(last=False)

    def stats(self) -> dict:
        return {"mem": len(self._mem), "mem_max": self._mem_max, "disk": bool(self._disk_dir)}
