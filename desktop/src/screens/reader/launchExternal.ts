// External links: http/https only, opened through the Rust command in Tauri
// (CSP/private-scheme safety) and window.open in browser dev.
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../../reader/keepAwake";

export function openExternal(href: string): boolean {
  if (!/^https?:\/\//i.test(href)) return false;
  void (async () => {
    try {
      if (isTauri()) await invoke("open_external_url", { url: href });
      else window.open(href, "_blank", "noopener,noreferrer");
    } catch {
      /* no browser hook in tests/browser-dev — ignore */
    }
  })();
  return true;
}
