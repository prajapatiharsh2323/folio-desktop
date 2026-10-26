import { useEffect } from "react";
import { Shell } from "./shell/Shell";
import { initTheme } from "./theme/theme";

export default function App() {
  useEffect(() => {
    initTheme();
  }, []);
  return <Shell />;
}
