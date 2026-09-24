import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 端口必须与 src-tauri/tauri.conf.json 的 devUrl（http://localhost:1420）一致
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
