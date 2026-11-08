import { Shell } from "./shell/Shell";
import { OnboardingFlow } from "./onboarding/OnboardingFlow";
import { Tour } from "./onboarding/Tour";
import { useOnboarding } from "./onboarding/onboardingState";

export default function App() {
  const stage = useOnboarding((s) => s.stage);

  if (stage === "prefs") return <OnboardingFlow />;

  return (
    <>
      <Shell />
      {stage === "tour" && <Tour />}
    </>
  );
}
