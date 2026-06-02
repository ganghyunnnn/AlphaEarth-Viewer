import { defineConfig } from "vite";

// 개발 중 백엔드(/api, /cog, /mosaicjson)를 8000 포트로 프록시
export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:8000",
      "/cog": "http://localhost:8000",
      "/mosaicjson": "http://localhost:8000",
    },
  },
});
