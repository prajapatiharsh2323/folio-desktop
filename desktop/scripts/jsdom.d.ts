// The perf script imports jsdom (a transitive vitest dependency, untyped in
// this tree). The harness only needs DOMParser; exact types are not required.
declare module "jsdom";
