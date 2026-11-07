import { useCallback, useEffect, useState } from "react";
import { Check, Loader2, Play, ShieldCheck } from "lucide-react";
import { Modal } from "./components";
import {
  native,
  healthState,
  configureHealth,
  checkLinks,
  openLink,
  type HealthState,
} from "./api";
import type { Snapshot } from "./model";
export function HealthPanel({
  data,
  websiteId,
  refresh,
  onClose,
}: {
  data: Snapshot;
  websiteId: string;
  refresh: () => Promise<Snapshot>;
  onClose: () => void;
}) {
  const [state, setState] = useState<HealthState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const name = data.websites.find((w) => w.id === websiteId)?.name;
  const load = useCallback(async () => {
    if (native) return;
    try {
      setState(await healthState());
      setError("");
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(() => {
    void load();
    if (native) return;
    const timer = setInterval(() => {
      void load();
      void refresh().catch(() => {});
    }, 2500);
    return () => clearInterval(timer);
  }, [load, refresh]);
  return (
    <Modal
      title="Link health"
      description="Daily availability checks help you spot links that may need replacing."
      onClose={onClose}
    >
      <div className="form-body">
        {native ? (
          <div className="hint-box">
            <p>
              Daily checks run through the local browser app while its Node
              server is running.
            </p>
            <button
              className="button"
              onClick={() => void openLink("http://127.0.0.1:4317/")}
            >
              Open local browser app
            </button>
          </div>
        ) : (
          <>
            <div className="health-notice">
              <ShieldCheck size={20} />
              <p>
                Checks request your affiliate URLs and may register tracking
                activity. A successful response does not prove the offer is
                active or that commissions work. Blocked checks need manual
                review.
              </p>
            </div>
            <div className="daily-setting">
              <div>
                <strong>Daily checks</strong>
                <small>
                  Checks active links every 24 hours while the local server is
                  running. Due checks catch up after it starts again. Archived
                  countries/channels are skipped.
                </small>
              </div>
              <button
                className={`button ${state?.enabled ? "" : "primary"}`}
                disabled={!state || busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setState(await configureHealth(!state?.enabled));
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {state?.enabled ? "Turn off" : "Enable daily checks"}
              </button>
            </div>
            <div className="health-manual">
              <span>{name ? `Check ${name}` : "Check all active links"}</span>
              <button
                className="button primary"
                disabled={busy || state?.running || !state}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setState(await checkLinks(websiteId));
                    await refresh();
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {state?.running ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Play size={14} />
                )}
                Check now
              </button>
            </div>
            {state?.running && (
              <p className="hint-box" role="status">
                Checking {state.processed} of {state.total} links… You can close
                this dialog; checks continue.
              </p>
            )}
            {state && !state.running && state.total > 0 && (
              <p className="health-complete">
                <Check size={14} />
                Last run: {state.processed} of {state.total} links checked
              </p>
            )}
            <div className="health-legend">
              <p>
                <span className="health-badge working">Working</span>{" "}
                Destination responds with HTTP 2xx.
              </p>
              <p>
                <span className="health-badge broken">Likely broken</span> HTTP
                404 or 410. Review and replace if needed.
              </p>
              <p>
                <span className="health-badge review">Needs review</span>{" "}
                Blocked, timeout, network error, login, or another unexpected
                response.
              </p>
            </div>
            <p className="muted small">
              Results appear under each app’s URL. Hover over a result for the
              check time and details. Edit a flagged link to replace its URL;
              the old check result is then cleared.
            </p>
          </>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <div className="form-actions">
        <button className="button" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
}
