// Feature flags (PDF plan §2 rule 2). A flag must be checked at every entry
// point of its feature so that turning it off restores exactly today's
// behaviour — including refusal copy — with nothing deleted or migrated.
//
// `FEATURES.pdf` gates: import detection (fileDetector), the reader engine
// factory, reader loading and the PDF UI. It turns on by default only after
// the Phase 5 sign-off; until then it stays false in shipped builds.

export const FEATURES: { pdf: boolean } = {
  /** PDF import + reading. On for development from Phase 1 (plan §12
   *  rollout); the shipped default is confirmed only after Phase 5 sign-off.
   *  Off ⇒ "PDF is not supported" everywhere, exactly as before the feature. */
  pdf: true,
};

export type FeatureName = keyof typeof FEATURES;

/** Single helper so call sites read the same way everywhere. */
export function featureEnabled(name: FeatureName): boolean {
  return FEATURES[name];
}

/** Test/flag-override hook: flips a flag for the calling scope. Release
 *  builds never call this; the flag-off suites use it to prove that turning
 *  the feature off restores today's behaviour. */
export function setFeatureEnabled(name: FeatureName, value: boolean): void {
  FEATURES[name] = value;
}
