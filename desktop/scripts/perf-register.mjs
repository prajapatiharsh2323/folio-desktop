// Installs the perf-loader hooks, then runs the harness.
//   cd desktop && pnpm perf   →   node --import ./scripts/perf-register.mjs scripts/perf.ts
import { register } from "node:module";
register("./perf-loader.mjs", import.meta.url);
