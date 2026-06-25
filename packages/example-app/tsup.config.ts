import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/service-worker.ts"],
  outDir: "public",
  format: ["esm"],
  outExtension: () => ({ js: ".js" }),
  bundle: true,
  minify: false,
  sourcemap: true,
  clean: false,
  platform: "browser",
  noExternal: ["@libre/listener-wallet", "@libre/shared", "lightningdevkit", "nostr-tools", "zod"],
  external: ["crypto"]
});
