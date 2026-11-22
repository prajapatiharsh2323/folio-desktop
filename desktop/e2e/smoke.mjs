// Folio WebDriver smoke (runbook E4 / P-20261116-01).
//
// Dependency-free: Node 24's global fetch drives the W3C WebDriver protocol
// directly, so nothing is added to package.json. Node 24 also strips the
// types from `src/perf/synthEpub.ts`, so the fixture EPUB is generated here.
//
// Prerequisites (Windows only):
//   1. cargo install tauri-driver --locked
//   2. download msedgedriver matching the installed WebView2 runtime
//      (https://msedgedriver.microsoft.com/<version>/edgedriver_win64.zip)
//   3. pnpm exec tauri build --no-sign   (or point --app at any build)
//   4. tauri-driver --port 4444 --native-driver <path to msedgedriver.exe>
//
// The run assumes a first-run profile. Folio has no data-dir override, so
// rename the real ones aside first and restore them afterwards:
//   %APPDATA%\Folio
//   %LOCALAPPDATA%\com.folio.desktop
//
// Run:
//   node e2e/smoke.mjs --app ../src-tauri/target/release/folio-desktop.exe
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSyntheticEpub } from "../src/perf/synthEpub.ts";

const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const DEFAULT_APP = fileURLToPath(
  new URL("../src-tauri/target/release/folio-desktop.exe", import.meta.url),
);
// The WebDriver binary resolves relative paths against its own cwd, so hand
// it an absolute path regardless of how the script was invoked.
const APP = resolve(argValue("--app", DEFAULT_APP));
const BASE = argValue("--driver", "http://127.0.0.1:4444");
const TITLE = "Perf Fixture";
const ELEMENT_KEY = "element-6066-11e4-a52e-4f735466cecf";

const results = [];
let sessionId = null;

function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  - ${detail}` : ""}`);
}

const idOf = (el) => el[ELEMENT_KEY];

async function wd(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { value: text };
  }
  if (!res.ok || (json.value && json.value.error)) {
    const err = json.value ?? json;
    throw new Error(`${method} ${path} -> ${res.status} ${err.error ?? ""} ${err.message ?? text}`);
  }
  return json.value;
}

async function until(what, fn, timeoutMs = 30000) {
  const start = Date.now();
  let lastErr;
  while (Date.now() - start < timeoutMs) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`timeout waiting for ${what}${lastErr ? `: ${lastErr.message}` : ""}`);
}

const findAll = (css) =>
  wd("POST", `/session/${sessionId}/elements`, { using: "css selector", value: css });
const click = (el) => wd("POST", `/session/${sessionId}/element/${idOf(el)}/click`, {});
const text = (el) => wd("GET", `/session/${sessionId}/element/${idOf(el)}/text`);
const attribute = (el, name) =>
  wd("GET", `/session/${sessionId}/element/${idOf(el)}/attribute/${name}`);
const exec = (script, scriptArgs = []) =>
  wd("POST", `/session/${sessionId}/execute/sync`, { script, args: scriptArgs });

const progressWidth = () =>
  exec(
    "const el = document.querySelector('.folio-reader-hairline__fill'); return el ? el.style.width : null;",
  );

async function newSession() {
  const created = await wd("POST", "/session", {
    capabilities: { alwaysMatch: { "tauri:options": { application: APP } } },
  });
  sessionId = created.sessionId;
  await wd("POST", `/session/${sessionId}/timeouts`, {
    implicit: 0,
    pageLoad: 60000,
    script: 30000,
  });
  return created.capabilities;
}

async function endSession() {
  if (!sessionId) return;
  const id = sessionId;
  sessionId = null;
  try {
    await wd("DELETE", `/session/${id}`);
  } catch (e) {
    console.log("session close warning:", e.message);
  }
}

async function findRow(title) {
  return until(
    `library row "${title}"`,
    async () => {
      for (const el of await findAll(".folio-book-row__open")) {
        if (String(await attribute(el, "aria-label")).includes(title)) return el;
      }
      return null;
    },
    60000,
  );
}

async function openRow(title) {
  const row = await findRow(title);
  await click(row);
  return row;
}

async function main() {
  const epubB64 = Buffer.from(buildSyntheticEpub(50 * 1024, 3)).toString("base64");
  console.log("creating session for", APP);
  const caps = await newSession();
  console.log(
    "session",
    sessionId,
    `${caps.browserName} ${caps.browserVersion} (driver ${caps.msedge?.msedgedriverVersion})`,
  );
  record("webdriver session created", true);

  // 1. First run -> setup step 1.
  await until("setup step 1", async () => (await findAll(".folio-setup__panel")).length > 0, 60000);
  record("first run shows setup", true);

  // 2. Continue -> step 2.
  const buttons = await findAll(".folio-setup__actions button");
  await click(buttons[0]);
  await until("setup step 2", async () => (await findAll(".folio-setup__drop")).length > 0, 30000);
  record("step 1 -> step 2 (Continue)", true);

  // 3. Synthetic HTML5 drop (the native dialog cannot be automated).
  await exec(
    `
      const bin = atob(arguments[0]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const dt = new DataTransfer();
      dt.items.add(new File([bytes], "smoke.epub", { type: "application/epub+zip" }));
      const target = document.querySelector(".folio-setup__drop");
      if (!target) return "no-drop-target";
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      return bytes.length;
      `,
    [epubB64],
  );
  record("drop event dispatched", true);

  // 4. Import lands in the library.
  await openRow(TITLE);
  record("import: library row present", true, TITLE);

  // 5-6. Reader mounts and the chapter renders inside the Readium iframe.
  await until("reader mount", async () => (await findAll(".folio-reader")).length > 0, 90000);
  record("open: reader mounted", true);

  const iframe = await until(
    "reader iframe",
    async () => (await findAll(".folio-reader iframe"))[0] ?? null,
    45000,
  );
  await wd("POST", `/session/${sessionId}/frame`, { id: { [ELEMENT_KEY]: idOf(iframe) } });
  const chapterText = await until(
    "chapter text",
    async () => {
      const body = await exec("return document.body ? document.body.innerText : '';");
      return body && body.length > 40 ? body : null;
    },
    30000,
  );
  await wd("POST", `/session/${sessionId}/frame`, { id: null });
  record(
    "read: chapter text rendered",
    /Chapter 1/.test(chapterText),
    chapterText.slice(0, 60).replace(/\s+/g, " "),
  );

  // 7. Page turns advance the hairline (also the location the resume uses).
  for (let i = 0; i < 2; i++) {
    await wd("POST", `/session/${sessionId}/actions`, {
      actions: [
        {
          type: "key",
          id: "keyboard",
          actions: [
            { type: "keyDown", value: "\uE014" },
            { type: "keyUp", value: "\uE014" },
          ],
        },
      ],
    });
    await new Promise((resolve) => setTimeout(resolve, 900));
  }
  const advanced = await until(
    "hairline progress",
    async () => {
      const width = await progressWidth();
      return width && parseFloat(width) > 0 ? width : null;
    },
    15000,
  );
  record("page turn: progress advanced", true, advanced);
  await wd("DELETE", `/session/${sessionId}/actions`);
  await new Promise((resolve) => setTimeout(resolve, 1200));

  // 8. Quit and relaunch: the library and progress survive.
  await endSession();
  await newSession();
  const row = await findRow(TITLE);
  record("resume: library survives relaunch", true);
  const rowText = await text(row);
  record("resume: progress label", /%/.test(rowText), rowText.replace(/\s+/g, " ").slice(0, 80));

  // 9. Reopen restores the saved position.
  await click(row);
  await until(
    "reader mount (relaunch)",
    async () => (await findAll(".folio-reader")).length > 0,
    90000,
  );
  const restored = await until(
    "restored progress",
    async () => {
      const width = await progressWidth();
      return width && parseFloat(width) > 0 ? width : null;
    },
    30000,
  );
  record("resume: position restored", true, restored);
}

try {
  await main();
} catch (e) {
  record("unexpected failure", false, e.message);
  try {
    const state = await exec(
      "return { url: location.href, body: document.body ? document.body.innerText.slice(0, 400) : '' };",
    );
    console.log("page state:", JSON.stringify(state));
  } catch {
    /* session already gone */
  }
} finally {
  await endSession();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
}
