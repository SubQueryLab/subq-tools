import { defineConfig } from "tsdown";

export default defineConfig([
  {
    entry: ["./src/index.ts", "./src/analytics/index.ts"],
    platform: "neutral",
    dts: true,
  },
]);
