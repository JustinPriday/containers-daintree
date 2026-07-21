import { daintreePlugin } from "@daintreehq/plugin-vite";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [daintreePlugin({ target: "node" })],
  resolve: {
    // docker-modem eagerly imports ssh2 even for Unix sockets. Replace that
    // optional native transport so the installable plugin remains pure JS and
    // fail closed if an unsupported SSH endpoint somehow reaches Dockerode.
    alias: {
      ssh2: fileURLToPath(new URL("./src/docker/unsupportedSsh.ts", import.meta.url)),
    },
  },
  build: {
    lib: {
      entry: { index: "src/index.ts" },
      formats: ["es"],
    },
    outDir: "dist",
    emptyOutDir: false,
    sourcemap: true,
    rollupOptions: {
      output: {
        banner:
          'import { createRequire as __createRequire } from "node:module"; const require = __createRequire(import.meta.url);',
        chunkFileNames: "[name].js",
        manualChunks(id) {
          const normalized = id.replaceAll("\\", "/");
          if (normalized.includes("/node_modules/dockerode/")) return "vendor-dockerode";
          if (normalized.includes("/node_modules/docker-modem/")) return "vendor-docker-modem";
          if (normalized.includes("/node_modules/zod/")) return "vendor-zod";
          if (
            normalized.includes("/node_modules/@grpc/") ||
            normalized.includes("/node_modules/@protobufjs/") ||
            normalized.includes("/node_modules/protobufjs/") ||
            normalized.includes("/node_modules/long/")
          ) {
            return "vendor-grpc-protobuf";
          }
          if (normalized.includes("/node_modules/")) return "vendor-docker-deps";
          return undefined;
        },
      },
    },
  },
});
