import { useEffect, useRef, useState } from "react";
import { canRefreshSource, refreshAccountSources } from "./refreshAccounts";
export default function AccountRefresh({
  api,
  sources,
  disabled,
  configured = true,
  onComplete,
  onBusyChange,
  label = "Refresh balances & transactions",
}: any) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const active = useRef(true),
    running = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const eligible = sources.filter(canRefreshSource);
  return (
    <div className="account-refresh">
      <button
        disabled={disabled || busy || !configured || !eligible.length}
        onClick={async () => {
          if (running.current) return;
          running.current = true;
          setBusy(true);
          setResult(null);
          setError("");
          onBusyChange?.(true);
          try {
            const next = await refreshAccountSources(
              api,
              sources,
              () => active.current,
            );
            if (!active.current) return;
            setResult(next);
            await onComplete?.();
          } catch (e: any) {
            if (active.current) setError(e.message);
          } finally {
            running.current = false;
            if (active.current) {
              setBusy(false);
              onBusyChange?.(false);
            }
          }
        }}
      >
        {busy ? "Refreshing balances & transactions…" : label}
      </button>
      {busy && (
        <p role="status">
          Checking connected institutions. This may take a moment.
        </p>
      )}
      {result && (
        <div role="status">
          {result.refreshed.length > 0 && (
            <p>
              Checked {result.refreshed.length}{" "}
              {result.refreshed.length === 1 ? "connection" : "connections"}.
              Showing the latest balances available from your institutions.
            </p>
          )}
          {result.failed.length > 0 && (
            <>
              <p>
                Some connections could not refresh. Saved balances remain
                visible. Retry or manage the connection in Admin.
              </p>
              <ul>
                {result.failed.map((f: any) => (
                  <li key={f.id}>
                    {sources.find((s: any) => s.id === f.id)?.displayName ||
                      "Connection"}
                    : {f.message}
                  </li>
                ))}
              </ul>
              <a className="back-link" href="#admin">
                Manage connections
              </a>
            </>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {!busy && !configured && (
        <p>
          Bank connections are not configured. <a href="#admin">Open Admin</a>.
        </p>
      )}
      {!busy && configured && !eligible.length && (
        <p>
          No connections are ready to refresh.{" "}
          <a href="#admin">Manage connections in Admin</a>.
        </p>
      )}
    </div>
  );
}
