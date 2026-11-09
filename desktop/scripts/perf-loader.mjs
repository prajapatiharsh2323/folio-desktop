// ESM hooks for the FT-005 perf harness.
//
// 1. Resolve: the app sources use extensionless relative imports (vite/tsc
//    resolve them), plain `node` cannot. Retry a failed relative resolve with
//    the typescript extensions.
// 2. Load: transpile `.ts` with the installed TypeScript compiler. Node's
//    built-in strip-only mode rejects parameter properties (used by the store
//    classes), so a full transpile keeps the harness runnable on Node 22.18+.
import { readFile } from "node:fs/promises";
import ts from "typescript";

export async function load(url, context, nextLoad) {
  if (url.startsWith("file:") && url.endsWith(".ts")) {
    const source = await readFile(new URL(url), "utf8");
    const { outputText } = ts.transpileModule(source, {
      fileName: new URL(url).pathname,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        verbatimModuleSyntax: false,
        sourceMap: false,
      },
    });
    return { format: "module", source: outputText, shortCircuit: true };
  }
  return nextLoad(url, context);
}

export function resolve(specifier, context, next) {
  if (specifier.startsWith(".")) {
    const base = context.parentURL ?? new URL("file:///").href;
    const asGiven = new URL(specifier, base).pathname;
    // Don't double-append: skip specifiers that already name a module file.
    if (!/\.(ts|tsx|js|mjs|cjs|json)$/.test(asGiven)) {
      for (const ext of [".ts", ".tsx", "/index.ts"]) {
        try {
          return next(new URL(specifier + ext, base).href, context);
        } catch {
          // try the next candidate
        }
      }
    }
  }
  return next(specifier, context);
}
