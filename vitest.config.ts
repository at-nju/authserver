import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "cloudflare:sockets": fileURLToPath(
        new URL("./tests/cloudflare_sockets_stub.ts", import.meta.url),
      ),
    },
  },
});
