import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: [
      "./src/index.ts",
      "./src/analytics/index.ts",
      "./src/vault/index.ts",
    ],
    platform: "neutral",
    dts: true,
  },
]);
