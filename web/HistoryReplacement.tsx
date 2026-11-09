import { useEffect, useRef, useState } from "react";
import { MatchReview } from "./AccountMatches";
type Api = (path: string, body?: unknown) => Promise<any>;
interface Source {
  id: string;
  label: string;
  institution_id: string;
  status: string;
  recoveryOnly?: boolean;
  replacementDescription?: string;
  replacementNeedsNickname?: boolean;
}
interface Account {
  provider_account_id: string;
  account_id: string;
  name: string;
  review: string | null;
}
interface Operation {
  id: string;
  old_source_id: string;
  new_source_id: string | null;
  state: string;
  last_error: string | null;
  oldStatus: string;
  oldDescription: string;
  newStatus: string | null;
  accounts: Account[];
  existingAccounts: Account[];
}
interface Props {
  api: Api;
  sources: Source[];
  institutions: { id: string; name: string }[];
  revision: string;
  onRefresh: () => Promise<unknown>;
  openLink: (sourceId: string, operationId: string) => Promise<unknown>;
  disabled: boolean;
}
export function replacementRevocationPrompt(description: string) {
  return `Revoke provider access for ${description}? Saved history stays here. You must authorize a new connection next, and access may remain unavailable if that fails.`;
}
const labels: Record<string, string> = {
  prepared: "Ready to revoke old access",
  old_access_revoked: "Old access revoked; ready to reconnect",
  awaiting_link: "Waiting for new authorization",
  importing: "Import in progress",
  awaiting_account_review: "Review imported accounts",
  reconciling: "Account choices saved; ready to reconcile",
  complete: "Replacement completed",
  cancelled: "Replacement cancelled; resume available",
  failed: "Replacement needs retry",
};
export default function HistoryReplacement({
  api,
  sources,
  institutions,
  revision,
  onRefresh,
  openLink,
  disabled,
}: Props) {
  const [operations, setOperations] = useState<Operation[]>([]),
    [error, setError] = useState(""),
    [working, setWorking] = useState(false),
    [comparison, setComparison] = useState<{
      operation: Operation;
      account: Account;
      review: any;
    } | null>(null);
  const alive = useRef(true),
    generation = useRef(0),
    heading = useRef<HTMLHeadingElement>(null);
  async function load() {
    const n = ++generation.current;
    try {
      const data = await api("/source-replacements");
      if (alive.current && n === generation.current)
        setOperations(data.operations);
    } catch (e: any) {
      if (alive.current) setError(e.message);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      alive.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    void load();
  }, [revision]);
  async function run(fn: () => Promise<unknown>, focusStatus = true) {
    setWorking(true);
    setError("");
    try {
      await fn();
    } catch (e: any) {
      if (alive.current) setError(e.message);
    } finally {
      await load();
      try {
        await onRefresh();
      } catch (e: any) {
        if (alive.current) setError(e.message);
      }
      if (alive.current) {
        setWorking(false);
        if (focusStatus) heading.current?.focus();
      }
    }
  }
  const blocked = disabled || working;
  const action = (o: Operation, a: string, body: unknown = {}) =>
    api(`/source-replacements/${encodeURIComponent(o.id)}/${a}`, body);
  return (
    <section
      className="history-replacement"
      aria-label="Longer history replacements"
    >
      <h2 ref={heading} tabIndex={-1}>
        Request longer history
      </h2>
      <p>
        New connections request 12 months (365 days). Your institution may
        return less. Sync and authorization repair do not extend the original
        request.
      </p>
      <p>
        Replacing a source requires revoking its old provider access before you
        authorize a new connection. Saved accounts, history and preferences stay
        here. Imports stop during reconnection; uninterrupted access and a full
        year of history cannot be guaranteed.
      </p>
      {error && (
        <div role="alert" className="error">
          <p>{error}</p>
          <button onClick={() => void load()}>Reload replacement status</button>
          <a className="shared-account-link" href="#accounts">
            Review or unlink existing account links
          </a>
        </div>
      )}
      {working && <p role="status">Saving replacement progress…</p>}
      {sources
        .filter(
          (s) =>
            !s.recoveryOnly &&
            !operations.some(
              (o) =>
                (o.old_source_id === s.id && o.state !== "complete") ||
                (o.new_source_id === s.id && o.state !== "complete"),
            ),
        )
        .map((s) => (
          <p key={s.id}>
            <button
              disabled={blocked}
              onClick={() =>
                void run(() =>
                  api(
                    `/data-sources/${encodeURIComponent(s.id)}/replacements`,
                    { confirm: true },
                  ),
                )
              }
            >
              Prepare replacement for{" "}
              {s.replacementDescription ||
                s.label ||
                institutions.find((i) => i.id === s.institution_id)?.name ||
                "data source"}
            </button>
            {s.replacementNeedsNickname && (
              <span>
                {" "}
                Save a distinct Source nickname below before preparing
                replacement.
              </span>
            )}
          </p>
        ))}
      {operations.map((o) => (
        <article className="connection" key={o.id}>
          <h3>
            {o.oldDescription}: {labels[o.state] || o.state}
          </h3>
          <p role="status">
            Old access:{" "}
            {o.oldStatus === "historical"
              ? "revoked; saved history retained"
              : o.oldStatus}
            . New access: {o.newStatus || "not connected"}.
          </p>
          {o.last_error && <p>{o.last_error}</p>}
          {o.accounts.some((a) => a.review === "match") && (
            <p>
              Confirmed account links and classification choices are saved.
              Cancelling keeps those choices.{" "}
              <a className="shared-account-link" href="#accounts">
                Review links and unlink to reverse a confirmed match
              </a>
            </p>
          )}
          {o.state === "prepared" && (
            <button
              className="danger secondary"
              disabled={blocked}
              onClick={() => {
                if (confirm(replacementRevocationPrompt(o.oldDescription)))
                  void run(() => action(o, "revoke", { confirm: true }));
              }}
            >
              Revoke old access to replace
            </button>
          )}
          {["old_access_revoked", "awaiting_link"].includes(o.state) && (
            <button
              disabled={blocked}
              onClick={() => void run(() => openLink(o.old_source_id, o.id))}
            >
              Connect replacement for 12 months
            </button>
          )}
          {["importing", "awaiting_account_review", "reconciling"].includes(
            o.state,
          ) && (
            <>
              <p>
                Replacement records are saved but excluded from estimates until
                all account choices and overlaps are resolved. A successful
                import does not prove complete date coverage.
              </p>
              <button
                disabled={blocked}
                onClick={() => void run(() => action(o, "sync"))}
              >
                Import available history and refresh review
              </button>
            </>
          )}
          {["awaiting_account_review", "reconciling"].includes(o.state) &&
            o.accounts.map((a) => (
              <section key={a.provider_account_id}>
                <h4>
                  {a.name} ·{" "}
                  {a.review ? "Choice saved: " + a.review : "Needs your review"}
                </h4>
                <a
                  className="shared-account-link"
                  href={`#accounts/${encodeURIComponent(a.account_id)}`}
                >
                  Inspect {a.name} source history
                </a>
                {a.review !== "match" && (
                  <>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        const left = String(
                          new FormData(e.currentTarget).get("existing"),
                        );
                        void run(async () => {
                          const review = await action(o, "match-review", {
                            leftId: left,
                            rightId: a.account_id,
                          });
                          if (alive.current)
                            setComparison({ operation: o, account: a, review });
                        }, false);
                      }}
                    >
                      <label>
                        Compare with existing account
                        <select name="existing" required defaultValue="">
                          <option value="" disabled>
                            Choose existing account
                          </option>
                          {o.existingAccounts.map((x) => (
                            <option key={x.account_id} value={x.account_id}>
                              {x.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button disabled={blocked}>Review possible match</button>
                    </form>
                    <button
                      className="secondary"
                      disabled={blocked}
                      onClick={() => {
                        if (
                          confirm(
                            "Keep this as a distinct real account? Confirm it is not another copy of an existing account. Both histories will count separately after replacement completes.",
                          )
                        )
                          void run(() =>
                            action(o, "review", {
                              providerAccountId: a.provider_account_id,
                              outcome: "distinct",
                              confirm: true,
                            }),
                          );
                      }}
                    >
                      Confirm distinct account
                    </button>
                  </>
                )}
              </section>
            ))}
          {["awaiting_account_review", "reconciling"].includes(o.state) && (
            <button
              disabled={blocked}
              onClick={() => void run(() => action(o, "complete"))}
            >
              Reconcile and complete replacement
            </button>
          )}
          {["failed", "cancelled"].includes(o.state) && (
            <button
              disabled={blocked}
              onClick={() => void run(() => action(o, "resume"))}
            >
              Resume replacement
            </button>
          )}
          {!["complete", "cancelled"].includes(o.state) && (
            <button
              className="secondary"
              disabled={blocked}
              onClick={() => void run(() => action(o, "cancel"))}
            >
              Cancel replacement
            </button>
          )}
        </article>
      ))}
      {comparison && (
        <>
          <p>
            Insufficient matching evidence requires more history or an explicit
            distinct-account choice. Review classifications before saving;
            confirmed matches and classification choices are saved immediately
            and can be unlinked in Accounts. The new source remains excluded
            from estimates until replacement completes.
          </p>
          <MatchReview
            preservePreferences
            review={comparison.review}
            disabled={blocked}
            onCancel={() => {
              setComparison(null);
              heading.current?.focus();
            }}
            onSubmit={(match: unknown) =>
              void run(async () => {
                await action(comparison.operation, "review", {
                  providerAccountId: comparison.account.provider_account_id,
                  outcome: "match",
                  confirm: true,
                  match,
                });
                if (alive.current) setComparison(null);
              })
            }
          />
        </>
      )}
    </section>
  );
}
