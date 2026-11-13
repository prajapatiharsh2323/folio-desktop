import { Shell } from "./shell/Shell";
import { ErrorBoundary } from "./shell/ErrorBoundary";
import { useBoot } from "./shell/useBoot";
import { BootSplash } from "./onboarding/BootSplash";
import { OnboardingFlow } from "./onboarding/OnboardingFlow";
import { Tour } from "./onboarding/Tour";
import { useOnboarding } from "./onboarding/onboardingState";

export default function App() {
  const stage = useOnboarding((s) => s.stage);
  const tourOpen = useOnboarding((s) => s.tourOpen);

  useBoot();

  if (stage === "booting") return <BootSplash />;
  if (stage === "look" || stage === "library") return <OnboardingFlow />;

  return (
    <ErrorBoundary variant="root">
      <Shell />
      {tourOpen && <Tour />}
    </ErrorBoundary>
  );
}
