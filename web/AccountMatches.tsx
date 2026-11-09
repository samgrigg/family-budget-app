import { useEffect, useRef, useState } from "react";
import { accountAmount } from "./accountRequests";
export function MatchReview({
  review,
  disabled,
  onSubmit,
  onCancel,
  preservePreferences = false,
}: any) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [review.token]);
  return (
    <section aria-label="Compare account sources" className="connection">
      <h3 ref={heading} tabIndex={-1}>
        Are these the same real account?
      </h3>
      <div className="match-comparison">
        {[review.left, review.right].map((a: any, i: number) => (
          <article key={a.id}>
            <h4>
              {i === 0 ? "Keep account identity" : "Link into this account"}:{" "}
              {a.name}
            </h4>
            <p>
              {a.institution}
              {a.provisional ? " · Institution unverified" : ""}
            </p>
            <p>
              {a.type || "Unknown type"} · {a.subtype || "Unknown subtype"} ·
              Mask: {a.masks.join(", ") || "Unknown"}
            </p>
            <p>
              Ownership: {a.ownership || "Unknown"} · Budgeting:{" "}
              {a.included ? "Included" : "Excluded"}
            </p>
            <ul>
              {a.sources.map((s: any) => (
                <li key={s.id}>
                  {s.label || `Data source ${a.sources.indexOf(s) + 1}`} ·{" "}
                  {s.status}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
      <p>
        {review.evidence.matchingSignatures} distinct matching posted
        signatures.{" "}
        {review.confidence === "strong"
          ? "Stronger evidence"
          : "Low-confidence review"}
        . Shared masks and similar names do not establish ownership or prove a
        match.
      </p>
      {[...review.reasons, ...review.uncertainty].map((r: string) => (
        <p key={r}>{r}</p>
      ))}
      <ul>
        {review.evidence.samples.map((s: any, i: number) => (
          <li key={i}>
            {s.date} · {s.description} · {accountAmount(s.currency, s.amount)}
          </li>
        ))}
      </ul>
      {review.linkable && (
        <form
          key={review.token}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const decisions = Object.fromEntries(
              review.decisions.map((g: any) => [g.id, f.get(g.id)]),
            );
            onSubmit({
              leftId: review.left.id,
              rightId: review.right.id,
              reviewToken: review.token,
              name: f.get("name"),
              included: f.get("included") === "yes",
              preferredSourceId: f.get("source"),
              decisions,
              confirm: true,
            });
          }}
        >
          <label>
            Account name after linking
            <input
              name="name"
              required
              maxLength={120}
              placeholder="Choose the account name"
              defaultValue={preservePreferences ? review.left.name : undefined}
              readOnly={preservePreferences}
            />
          </label>
          <label>
            Budgeting inclusion
            <select
              name="included"
              required
              defaultValue={
                preservePreferences ? (review.left.included ? "yes" : "no") : ""
              }
            >
              <option value="" disabled>
                Choose inclusion
              </option>
              <option
                value="yes"
                disabled={preservePreferences && !review.left.included}
              >
                Include in budgeting
              </option>
              <option
                value="no"
                disabled={preservePreferences && review.left.included}
              >
                Exclude from budgeting
              </option>
            </select>
          </label>
          <label>
            Preferred active source
            <select name="source" required defaultValue="">
              <option value="" disabled>
                Choose a source
              </option>
              {[...review.left.sources, ...review.right.sources]
                .filter(
                  (s: any) =>
                    !["historical", "revoke_required"].includes(s.status),
                )
                .map((s: any) => (
                  <option key={s.id} value={s.id}>
                    {s.label ||
                      `${review.left.sources.some((left: any) => left.id === s.id) ? review.left.name : review.right.name} source`}{" "}
                    ({s.status})
                  </option>
                ))}
            </select>
          </label>
          <p>
            The preferred source supplies matching current records. Older
            unmatched records stay available. Uncertain overlaps are withheld
            from estimates for review.
          </p>
          {review.decisions.map((g: any) => (
            <label key={g.id}>
              {g.kind === "bills"
                ? "Bill"
                : g.kind === "income_decisions"
                  ? "Income"
                  : "Transfer"}{" "}
              classification
              <select name={g.id} required defaultValue="">
                <option value="" disabled>
                  Choose a classification
                </option>
                {g.options.map((o: any) => (
                  <option key={o.id} value={o.id}>
                    {g.details?.find((d: any) => d.id === o.id)?.accountName}:{" "}
                    {o.name || "Transfer"} · {o.status}
                    {o.excluded
                      ? ` · ${JSON.parse(o.excluded).length} exclusions`
                      : ""}
                  </option>
                ))}
                {!preservePreferences && (
                  <option value="review">Return to review</option>
                )}
              </select>
            </label>
          ))}
          {review.decisions.map((g: any) => (
            <div key={g.id}>
              {g.options.map((o: any) => {
                const detail = g.details?.find((d: any) => d.id === o.id);
                return (
                  <div key={o.id}>
                    <p>
                      {detail?.accountName} · {o.name || "Transfer"} ·{" "}
                      {o.status}
                    </p>
                    {detail?.exclusions.length > 0 && (
                      <ul>
                        {detail.exclusions.map((t: any, i: number) => (
                          <li key={i}>
                            {t.unresolved
                              ? "Unresolved historical exclusion (retained for review)"
                              : `Excluded: ${t.date} · ${t.name} · ${accountAmount(t.currency, t.amount)}`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
          <p>
            Original names, inclusion and classifications are recorded for
            unlinking. Later edits require an explicit resolution. Raw source
            records are retained. Transfers between aliases of the same account
            no longer apply.
          </p>
          <button disabled={disabled}>Confirm account link</button>
        </form>
      )}
      <button
        type="button"
        className="secondary"
        disabled={disabled}
        onClick={onCancel}
      >
        Close review
      </button>
    </section>
  );
}
export default function AccountMatches({ api, onRefresh, revision }: any) {
  const [data, setData] = useState<any>(null),
    [review, setReview] = useState<any>(null),
    [unlink, setUnlink] = useState<any>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const generation = useRef(0),
    active = useRef(true);
  async function load() {
    const n = ++generation.current;
    try {
      const [matches, links] = await Promise.all([
        api("/account-matches"),
        api("/account-links"),
      ]);
      if (active.current && n === generation.current)
        setData({ ...matches, ...links });
    } catch (e: any) {
      if (active.current && n === generation.current) setError(e.message);
    }
  }
  useEffect(() => {
    void load();
    return () => {
      active.current = false;
      generation.current++;
    };
  }, []);
  useEffect(() => {
    void load();
  }, [revision]);
  async function run(fn: () => Promise<any>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      if (active.current) {
        await onRefresh();
        await load();
      }
    } catch (e: any) {
      if (active.current) setError(e.message);
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <section aria-label="Account matches">
      <h2>Account matches</h2>
      <p>
        Review evidence before combining accounts exposed by different data
        sources. Nothing is linked automatically.
      </p>
      {error && (
        <p role="alert" className="error">
          {error} <button onClick={() => void load()}>Reload matches</button>
        </p>
      )}
      {!data && <p role="status">Loading account matches…</p>}
      {data && !data.suggestions.length && (
        <p>No likely matches with enough compatible posted history.</p>
      )}
      {data?.suggestions.map((r: any) => (
        <p key={r.token}>
          <button
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const next = await api(
                  `/account-matches/review?left=${encodeURIComponent(r.left.id)}&right=${encodeURIComponent(r.right.id)}`,
                );
                if (active.current) {
                  setReview(next);
                  setUnlink(null);
                }
              })
            }
          >
            Review {r.left.name} and {r.right.name}
          </button>{" "}
          · {r.evidence.matchingSignatures} matching signatures ·{" "}
          {r.confidence === "strong" ? "Stronger evidence" : "Low confidence"}
        </p>
      ))}
      {review && (
        <MatchReview
          review={review}
          disabled={busy}
          onCancel={() => setReview(null)}
          onSubmit={(body: any) => {
            if (
              confirm(
                "Link these sources as one real account? Matching history will count once, uncertain overlaps will be withheld from estimates, and your selected name, inclusion and classifications will apply. You can unlink later with a review of subsequent edits.",
              )
            )
              void run(async () => {
                await api("/account-links", body);
                if (active.current) setReview(null);
              });
          }}
        />
      )}
      <h3>Link history</h3>
      {data?.operations.map((o: any) => (
        <article className="connection" key={o.id}>
          <h4>{o.previous.map((a: any) => a.name).join(" + ")}</h4>
          <p>
            {o.status === "linked"
              ? "Linked"
              : o.status === "deleted"
                ? "Account history deleted"
                : "Unlinked"}{" "}
            · {o.created_at.slice(0, 10)}
          </p>
          {o.status === "linked" && (
            <>
              <p>
                To add another account or replace a source, review and unlink
                this operation first. All source history is preserved.
              </p>
              <a href={`#accounts/${encodeURIComponent(o.left_id)}`}>
                View account and source history
              </a>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const next = await api(
                      `/account-links/${encodeURIComponent(o.id)}/unlink-review`,
                    );
                    if (active.current) {
                      setUnlink(next);
                      setReview(null);
                    }
                  })
                }
              >
                Review unlink
              </button>
              <PreferredSource
                api={api}
                operation={o}
                disabled={busy}
                run={run}
              />
            </>
          )}
        </article>
      ))}
      {unlink && (
        <form
          className="connection"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (
              confirm(
                "Unlink these sources into their previous accounts? Estimates will recalculate from separate histories. Your chosen resolution applies to later edits; original audit records remain.",
              )
            )
              void run(async () => {
                await api(
                  `/account-links/${encodeURIComponent(unlink.id)}/unlink`,
                  { confirm: true, resolution: f.get("resolution") },
                );
                if (active.current) setUnlink(null);
              });
          }}
        >
          <h3>Review unlink consequences</h3>
          <p>
            Previous source mappings are restored. Unrelated account edits
            remain unchanged.
          </p>
          {unlink.preferences && (
            <p>
              Current account: {unlink.preferences.name} ·{" "}
              {unlink.preferences.included
                ? "Included in budgeting"
                : "Excluded from budgeting"}
            </p>
          )}
          <ul>
            {unlink.current.map((d: any) => (
              <li key={d.kind + d.row.key}>
                {d.row.name || "Transfer"} · {d.row.status}
                {d.row.excluded
                  ? ` · ${JSON.parse(d.row.excluded).length} exclusions`
                  : ""}
              </li>
            ))}
          </ul>
          {unlink.conflicts.map((c: string) => (
            <p key={c}>{c}</p>
          ))}
          {!!unlink.conflicts.length && (
            <label>
              Resolve later edits
              <select name="resolution" required defaultValue="">
                <option value="" disabled>
                  Choose a resolution
                </option>
                <option value="restore_previous">
                  Restore previous preferences and classifications; archive
                  later decisions
                </option>
                <option value="keep_survivor">
                  Keep later edits on the surviving account; restore the other
                  account
                </option>
              </select>
            </label>
          )}
          <button disabled={busy}>Confirm unlink</button>{" "}
          <button
            type="button"
            className="secondary"
            onClick={() => setUnlink(null)}
          >
            Cancel
          </button>
        </form>
      )}
    </section>
  );
}
function PreferredSource({ api, operation, disabled, run }: any) {
  const [sources, setSources] = useState<any[]>([]);
  useEffect(() => {
    let active = true;
    api(`/accounts/${encodeURIComponent(operation.left_id)}`)
      .then((d: any) => {
        if (active) setSources(d.sources);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [operation.left_id]);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const sourceId = new FormData(e.currentTarget).get("source");
        void run(() =>
          api(
            `/account-links/${encodeURIComponent(operation.id)}/preferred-source`,
            { sourceId },
          ),
        );
      }}
    >
      <label>
        Preferred source
        <select
          name="source"
          defaultValue={operation.preferred_source}
          key={operation.preferred_source + sources.length}
        >
          {sources.map((s) => (
            <option
              disabled={
                s.replacementPending ||
                ["historical", "revoke_required"].includes(s.status)
              }
              key={s.id}
              value={s.id}
            >
              {s.label || "Data source"} ·{" "}
              {s.replacementPending ? "Pending replacement review" : s.status}
            </option>
          ))}
        </select>
      </label>
      <button
        disabled={
          disabled ||
          !sources.some(
            (s) =>
              !s.replacementPending &&
              !["historical", "revoke_required"].includes(s.status),
          )
        }
      >
        Save preferred source
      </button>
    </form>
  );
}
