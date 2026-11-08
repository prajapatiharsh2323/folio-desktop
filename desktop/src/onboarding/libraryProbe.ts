// Detect a library that predates the current WebView storage. Onboarding flags
// live in localStorage, so a cleared profile or a backup restored on another
// machine must not look like a fresh install.
import { libraryLayout as L } from "../lib/libraryPaths";
import { getLibraryFs, getLibraryManager } from "../store/libraryUi";

export interface LibraryProbe {
  hasDocs: boolean;
  hasSettings: boolean;
}

export async function probeExistingLibrary(): Promise<LibraryProbe> {
  try {
    const lm = getLibraryManager();
    const manifest = await lm.load();
    if ((manifest?.docs.length ?? 0) > 0) {
      return { hasDocs: true, hasSettings: false };
    }
    const hasSettings = await getLibraryFs().exists(L.settings(lm.root));
    return { hasDocs: false, hasSettings };
  } catch {
    // An unreadable library must not trap the user on a splash: fall through
    // to the normal first-run flow, where the Library screen reports the error.
    return { hasDocs: false, hasSettings: false };
  }
}
