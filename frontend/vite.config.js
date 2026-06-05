import { defineConfig } from "vite";

// In dev, proxy the backend (/api, /cog, /mosaicjson) to port 8000
export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:8000",
      "/cog": "http://localhost:8000",
      "/mosaicjson": "http://localhost:8000",
    },
  },
});
