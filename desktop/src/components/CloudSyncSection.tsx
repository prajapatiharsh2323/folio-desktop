import { useState } from "react";
import { FolioButton } from "./FolioButton";
import { FolioChip } from "./FolioChip";
import { FolioDialog } from "./FolioDialog";
import { FolioSectionHeader } from "./FolioSectionHeader";
import { FolioSettingsRow } from "./FolioSettingsRow";
import {
  getClientConfig,
  isTauri,
  saveClientConfig,
  signIn,
  signOut,
} from "../sync/auth";
import { failureCopy, SyncFailure } from "../sync/driveClient";
import { classifySyncError } from "../sync/engine";
import { useSyncStatus } from "../sync/status";

/** Cloud sync card (06 §4, 09 §2): sign-in, first-sync consent, status, retry. */
export function CloudSyncSection() {
  const signedIn = useSyncStatus((s) => s.signedIn);
  const checking = useSyncStatus((s) => s.checking);
  const busy = useSyncStatus((s) => s.busy);
  const status = useSyncStatus((s) => s.status);
  const failure = useSyncStatus((s) => s.failure);
  const result = useSyncStatus((s) => s.result);
  const lastSync = useSyncStatus((s) => s.lastSyncAt);
  const auto = useSyncStatus((s) => s.auto);
  const setAuto = useSyncStatus((s) => s.setAuto);
  const setSignedIn = useSyncStatus((s) => s.setSignedIn);
  const runNow = useSyncStatus((s) => s.runNow);
  const reset = useSyncStatus((s) => s.reset);

  const [consentOpen, setConsentOpen] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const [clientId, setClientId] = useState(() => getClientConfig().clientId);
  const [clientSecret, setClientSecret] = useState(
    () => getClientConfig().clientSecret ?? ""
  );

  const working = busy || connecting;

  const requestConnect = () => {
    const config = getClientConfig();
    if (!config.clientId.trim()) {
      setAdvanced(true);
      useSyncStatus.setState({
        failure: new SyncFailure(
          "AUTH",
          "Add a Google OAuth Desktop client ID below, or build with VITE_GOOGLE_CLIENT_ID."
        ),
      });
      return;
    }
    useSyncStatus.setState({ failure: null });
    setConsentOpen(true);
  };

  const acceptConsent = async () => {
    setConsentOpen(false);
    setConnecting(true);
    useSyncStatus.setState({ status: "Waiting for Google sign-in…" });
    try {
      await signIn();
      setSignedIn(true);
      useSyncStatus.setState({ status: null });
      setConnecting(false);
      await runNow();
    } catch (e) {
      useSyncStatus.setState({
        failure: classifySyncError(e),
        status: null,
      });
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    setConnecting(true);
    try {
      await signOut();
      reset();
    } catch (e) {
      useSyncStatus.setState({ failure: classifySyncError(e) });
    } finally {
      setConnecting(false);
    }
  };

  const saveClient = () => {
    saveClientConfig({
      clientId: clientId.trim(),
      clientSecret: clientSecret.trim() || undefined,
    });
    useSyncStatus.setState({ failure: null });
    setAdvanced(false);
  };

  const summaryText = result
    ? `Pulled ${result.pulled} · pushed ${result.pushed} · merged ${result.merged}${
        result.remapped ? ` · re-keyed ${result.remapped}` : ""
      }`
    : null;

  if (!isTauri()) {
    return (
      <>
        <FolioSectionHeader>Cloud sync</FolioSectionHeader>
        <FolioSettingsRow
          title="Google Drive"
          helper="Cloud sync is available in the Folio desktop app."
        />
      </>
    );
  }

  return (
    <>
      <FolioSectionHeader>Cloud sync</FolioSectionHeader>

      {checking ? (
        <FolioSettingsRow title="Google Drive" helper="Checking connection…" />
      ) : signedIn ? (
        <>
          <FolioSettingsRow
            title="Google Drive"
            helper="Connected · mirror lives in “Folio Library”"
            control={
              <div className="folio-sync-actions">
                <FolioButton variant="secondary" disabled={working} onClick={() => void runNow()}>
                  {busy ? "Syncing…" : "Sync now"}
                </FolioButton>
                <FolioButton variant="ghost" disabled={working} onClick={() => void disconnect()}>
                  Disconnect
                </FolioButton>
              </div>
            }
          />
          <FolioSettingsRow
            title="Automatic sync"
            helper="Every 15 minutes while Folio is open"
            control={
              <FolioChip selected={auto} onClick={() => setAuto(!auto)}>
                {auto ? "On" : "Off"}
              </FolioChip>
            }
          />
          <FolioSettingsRow
            title="Last sync"
            helper={
              status ?? (lastSync ? new Date(lastSync).toLocaleString() : "Not synced yet")
            }
          />
          {summaryText && <p className="folio-sync-summary">{summaryText}</p>}
          {failure && (
            <div className="folio-sync-banner" role="alert">
              <div className="folio-sync-banner__text">
                <strong>Sync failed</strong>
                <span>{failureCopy(failure)}</span>
                {failure.message && failure.message !== failureCopy(failure) && (
                  <span className="folio-sync-banner__detail">{failure.message}</span>
                )}
              </div>
              <FolioButton variant="secondary" disabled={working} onClick={() => void runNow()}>
                Retry
              </FolioButton>
            </div>
          )}
        </>
      ) : (
        <>
          <FolioSettingsRow
            title="Google Drive"
            helper="Mirror your library to “Folio Library/” in Drive. Folio only sees files it creates."
            control={
              <FolioButton disabled={working} onClick={requestConnect}>
                Connect
              </FolioButton>
            }
          />
          {(advanced || !getClientConfig().clientId) && (
            <div className="folio-sync-config">
              <label className="folio-sync-config__label" htmlFor="folio-oauth-client">
                Google OAuth Desktop client ID
              </label>
              <input
                id="folio-oauth-client"
                className="folio-filter-select folio-sync-config__input"
                value={clientId}
                placeholder="1234567890-abc.apps.googleusercontent.com"
                onChange={(e) => setClientId(e.target.value)}
                spellCheck={false}
              />
              <label className="folio-sync-config__label" htmlFor="folio-oauth-secret">
                Client secret (Desktop app clients)
              </label>
              <input
                id="folio-oauth-secret"
                className="folio-filter-select folio-sync-config__input"
                value={clientSecret}
                placeholder="GOCSPX-…"
                onChange={(e) => setClientSecret(e.target.value)}
                spellCheck={false}
                type="password"
                autoComplete="off"
              />
              <div className="folio-sync-config__actions">
                <FolioButton variant="secondary" onClick={saveClient} disabled={!clientId.trim()}>
                  Save client
                </FolioButton>
                {getClientConfig().clientId && (
                  <FolioButton variant="ghost" onClick={() => setAdvanced(false)}>
                    Done
                  </FolioButton>
                )}
              </div>
              <p className="folio-sync-config__hint">
                Create a <em>Desktop app</em> OAuth client in Google Cloud Console and enable the
                Drive API. Release builds can bake it in with VITE_GOOGLE_CLIENT_ID and
                VITE_GOOGLE_CLIENT_SECRET.
              </p>
            </div>
          )}
          {failure && (
            <div className="folio-sync-banner" role="alert">
              <div className="folio-sync-banner__text">
                <strong>Google Drive</strong>
                <span>{failureCopy(failure)}</span>
                {failure.message && (
                  <span className="folio-sync-banner__detail">{failure.message}</span>
                )}
              </div>
            </div>
          )}
          {!advanced && getClientConfig().clientId && (
            <p className="folio-sync-summary">
              <button type="button" className="folio-link" onClick={() => setAdvanced(true)}>
                Change OAuth client
              </button>
            </p>
          )}
        </>
      )}

      <FolioDialog
        open={consentOpen}
        onClose={() => setConsentOpen(false)}
        title="Sync with Google Drive"
        actions={
          <>
            <FolioButton variant="secondary" onClick={() => setConsentOpen(false)}>
              Not now
            </FolioButton>
            <FolioButton onClick={() => void acceptConsent()}>Connect Drive</FolioButton>
          </>
        }
      >
        <div className="folio-sync-consent">
          <p>Folio will keep a mirror of your library in Google Drive:</p>
          <ul>
            <li>
              Folder <strong>Folio Library</strong>, visible only to this app (drive.file).
            </li>
            <li>Books, covers, progress, annotations, and collections.</li>
            <li>Nothing is deleted from Drive when you delete locally.</li>
            <li>The Google account is only used for this app’s own Drive folder.</li>
          </ul>
          <p className="folio-helper">
            Your Google password never touches Folio. The refresh token stays in Windows
            Credential Manager; sign-in happens in your system browser.
          </p>
        </div>
      </FolioDialog>
    </>
  );
}
