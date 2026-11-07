import { useEffect } from "react";
import { Shell } from "./shell/Shell";
import { initTheme } from "./theme/theme";
import { OnboardingFlow } from "./onboarding/OnboardingFlow";
import { Tour } from "./onboarding/Tour";
import { useOnboarding } from "./onboarding/onboardingState";

export default function App() {
  const stage = useOnboarding((s) => s.stage);

  useEffect(() => {
    const cleanup = initTheme();
    return cleanup;
  }, []);

  if (stage === "prefs") return <OnboardingFlow />;

  return (
    <>
      <Shell />
      {stage === "tour" && <Tour />}
    </>
  );
}
