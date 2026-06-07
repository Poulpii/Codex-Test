import { defineConfig } from "vite";

export default defineConfig({
  publicDir: false,
  build: {
    assetsDir: "app",
    emptyOutDir: true
  },
  server: {
    proxy: {
      "/api": "http://127.0.0.1:3000",
      "/Documents": "http://127.0.0.1:3000",
      "/assets": "http://127.0.0.1:3000"
    }
  }
});
