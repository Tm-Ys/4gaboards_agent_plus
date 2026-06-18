import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// dev: 5173，/api 代理到后端 8787（SSE 长连接 proxy 默认支持，非 WebSocket）。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
