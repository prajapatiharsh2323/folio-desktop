// ESM resolve hook for the FT-005 perf harness: the app sources use
// extensionless relative imports (vite/tsc resolve them), plain `node`
// cannot. This retries a failed relative resolve with the typescript
// extensions; TS type-stripping turns the file into plain ESM afterwards.
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
