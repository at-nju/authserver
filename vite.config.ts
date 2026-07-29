import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import { config } from "./config";

export default defineConfig({
  root: "web",
  plugins: [preact()],
  define: { __APP_NAME__: JSON.stringify(config.appName) },
  build: { outDir: "../dist", emptyOutDir: true },
});
