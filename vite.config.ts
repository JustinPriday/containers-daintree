import { daintreePlugin } from "@daintreehq/plugin-vite";
import { defineConfig } from "vite";
import { readFileSync } from "node:fs";

const manifest = JSON.parse(readFileSync(new URL("./plugin.json", import.meta.url), "utf8")) as {
  version: string;
};

export default defineConfig({
  plugins: [daintreePlugin()],
  build: {
    lib: {
      entry: { panel: "src/panel.react.tsx" },
      formats: ["es"],
      fileName: () => `panel-${manifest.version}.js`,
    },
    outDir: "dist",
    // Daintree's dev command watches only this browser config. Preserve the
    // separately-built Node worker while that watcher rebuilds the panel.
    emptyOutDir: false,
    sourcemap: true,
  },
});
