import React, { useEffect, useState } from "react";
import type {
  ReviewLedger,
  Obligation,
  Paycheck,
} from "../shared/paycheckReview";
import { parseReviewMoney, formatReviewMoney } from "../shared/reviewMoney";
import { draftChanges, previewReview } from "./reviewDraft";
import ReviewSummary, { reviewMoney } from "./ReviewSummary";
import ReviewCommitments from "./ReviewCommitments";
import ReviewCards from "./ReviewCards";
const newId = () => `tmp:${crypto.randomUUID()}`;
const field = (f: FormData, k: string) => String(f.get(k) ?? "");
export default function PaycheckReview({
  api,
}: {
  api: (path: string, body?: any) => Promise<any>;
}) {
  const [data, setData] = useState<any>(null),
    [ledger, setLedger] = useState<ReviewLedger | null>(null),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState<Obligation | null>(null),
    [showObligation, setShowObligation] = useState(false);
  const dirty = !!(data && ledger && draftChanges(data.ledger, ledger).length);
  const run = (fn: () => void) => {
    try {
      setError("");
      fn();
      setNotice("Unsaved changes.");
    } catch (e: any) {
      setError(e.message);
    }
  };
  async function load() {
    setBusy(true);
    try {
      const d = await api("/paycheck-review");
      setData(d);
      setLedger(d.ledger);
      setSelected((v) =>
        d.ledger.paychecks.some((p: Paycheck) => p.id === v)
          ? v
          : (d.ledger.paychecks
              .filter((p: Paycheck) => p.state === "received")
              .at(-1)?.id ?? ""),
      );
      setError("");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const navigate = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest("a");
      if (
        a &&
        a.getAttribute("href") !== "#paycheck-review" &&
        !confirm("Leave this review and discard unsaved changes?")
      ) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty]);
  if (!data || !ledger)
    return (
      <section className="panel">
        <h1 id="main-content" tabIndex={-1}>
          Paycheck Review
        </h1>
        {error ? <p role="alert">{error}</p> : <p>Loading review…</p>}
        <button onClick={() => void load()} disabled={busy}>
          Retry
        </button>
      </section>
    );
  const selectedPaycheck = ledger.paychecks.find((p) => p.id === selected);
  const projection = selectedPaycheck
    ? previewReview(ledger, selected, data.asOf)
    : null;
  if (projection) {
    const server = data.projections.find((p: any) => p.paycheckId === selected);
    if (
      (!dirty &&
        server?.issues.some((i: any) => i.code === "EVIDENCE_CHANGED")) ||
      data.evidence.issues.length
    ) {
      projection.safeToSpendMinor = null;
      projection.leftoverMinor = null;
      projection.issues.push({
        code: "EVIDENCE_CHANGED",
        recordId: selected,
        message:
          "Bank or plan evidence needs confirmation. Review the data and save again.",
      });
    }
  }
  const patch = (
    collection: keyof Omit<ReviewLedger, "revision">,
    record: any,
  ) =>
    setLedger((l) => {
      if (!l) return l;
      const key = collection === "reviews" ? "paycheckId" : "id";
      return {
        ...l,
        [collection]: [
          ...(l[collection] as any[]).filter((r) => r[key] !== record[key]),
          record,
        ],
      };
    });
  const submit = (
    e: React.FormEvent<HTMLFormElement>,
    fn: (f: FormData) => void,
  ) => {
    e.preventDefault();
    run(() => fn(new FormData(e.currentTarget)));
  };
  async function save(complete = false) {
    if (!ledger) return;
    setBusy(true);
    setError("");
    try {
      const next = structuredClone(ledger);
      if (selectedPaycheck) {
        next.reviews = next.reviews.filter((r) => r.paycheckId !== selected);
        next.reviews.push({
          paycheckId: selected,
          completedAt: complete ? data.asOf : null,
          evidenceDigest: data.evidence.digest,
        });
      }
      const d = await api("/paycheck-review", {
        expectedRevision: data.ledger.revision,
        evidenceDigest: data.evidence.digest,
        changes: draftChanges(data.ledger, next),
      });
      setData(d);
      setLedger(d.ledger);
      setSelected(d.idMap?.[selected] ?? selected);
      setNotice(
        complete
          ? "Review completed. Reservations do not move money."
          : "Review saved.",
      );
    } catch (e: any) {
      setError(e.message + " Your unsaved input is still here.");
    } finally {
      setBusy(false);
    }
  }
  const reserve = (id: string, paycheckId: string, value: string) =>
    run(() => {
      const amountMinor = parseReviewMoney(value),
        old = ledger.contributions.find(
          (c) => c.obligationId === id && c.paycheckId === paycheckId,
        ),
        pay = ledger.paychecks.find((p) => p.id === paycheckId)!,
        o = ledger.obligations.find((o) => o.id === id)!;
      if (!o.neededBy) throw Error("Confirm the funding deadline first.");
      patch("contributions", {
        id: old?.id ?? newId(),
        paycheckId,
        obligationId: id,
        amountMinor,
        paymentAccountId: ledger.sources.find((s) => s.id === pay.sourceId)!
          .accountId,
        neededBy: o.neededBy,
      });
    });
  const sections = selectedPaycheck
    ? {
        ledger,
        paycheckId: selected,
        accounts: data.evidence.accounts,
        transactions: data.evidence.transactions,
        onReserve: reserve,
        onEdit: (o: Obligation) => {
          setEditing(o);
          setShowObligation(true);
        },
        onRemove: (id: string) =>
          run(() => {
            if (ledger.settlements.some((s) => s.obligationId === id))
              throw Error(
                "This obligation has payment evidence. Correct the amount instead of removing it.",
              );
            if (confirm("Remove this obligation and release its reservations?"))
              setLedger({
                ...ledger,
                obligations: ledger.obligations.filter((o) => o.id !== id),
                contributions: ledger.contributions.filter(
                  (c) => c.obligationId !== id,
                ),
              });
          }),
        onSettle: (id: string, txId: string) =>
          run(() => {
            const t = data.evidence.transactions.find(
              (t: any) => t.id === txId,
            );
            if (!t) throw Error("Choose a posted payment.");
            const c = ledger.contributions.find(
              (c) => c.obligationId === id && c.paycheckId === selected,
            );
            if (!c)
              throw Error("Set a reservation before recording its payment.");
            patch("settlements", {
              id: newId(),
              paycheckId: selected,
              obligationId: id,
              contributionId: c.id,
              amountMinor: parseReviewMoney(t.amount),
              transactionIds: [txId],
              confirmed: true,
            });
          }),
      }
    : null;
  return (
    <>
      <h1 id="main-content" tabIndex={-1}>
        Paycheck Review
      </h1>
      <p>What work does this money have to do before you get replenished?</p>
      <p role="status">{notice}</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <section className="panel">
        <h2>Start or resume</h2>
        <label>
          Paycheck
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
          >
            <option value="">Select a paycheck</option>
            {ledger.paychecks.map((p) => (
              <option key={p.id} value={p.id}>
                {ledger.sources.find((s) => s.id === p.sourceId)?.name} ·{" "}
                {p.date} · {reviewMoney(p.amountMinor)} · {p.state}
              </option>
            ))}
          </select>
        </label>
        <details>
          <summary>Set up an income source</summary>
          <form
            onSubmit={(e) =>
              submit(e, (f) =>
                patch("sources", {
                  id: newId(),
                  name: field(f, "name"),
                  accountId: field(f, "account"),
                  incomeKey: null,
                }),
              )
            }
          >
            <label>
              Employer
              <input
                name="name"
                placeholder="Canyons or Adobe"
                required
                maxLength={150}
              />
            </label>
            <label>
              Paycheck account
              <select name="account" required>
                <option value="">Choose account</option>
                {data.evidence.accounts
                  .filter((a: any) => a.type !== "credit")
                  .map((a: any) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.included ? "" : " · hidden from budgets"}
                    </option>
                  ))}
              </select>
            </label>
            <button>Add income source</button>
          </form>
        </details>
        <details open={!selectedPaycheck}>
          <summary>Add an arrived or expected paycheck</summary>
          <form
            onSubmit={(e) =>
              submit(e, (f) => {
                const state = field(f, "state"),
                  sourceId = field(f, "source"),
                  source = ledger.sources.find((s) => s.id === sourceId);
                if (!source) throw Error("Set up an income source first.");
                const t = data.evidence.transactions.find(
                  (t: any) => t.id === field(f, "deposit"),
                );
                if (
                  state === "received" &&
                  (!t || t.accountId !== source.accountId)
                )
                  throw Error("Choose a deposit into this source’s account.");
                const id = newId();
                patch("paychecks", {
                  id,
                  sourceId,
                  state,
                  transactionId: state === "received" ? t.id : null,
                  amountMinor:
                    state === "received"
                      ? parseReviewMoney(t.amount.slice(1))
                      : parseReviewMoney(field(f, "amount")),
                  date: state === "received" ? t.date : field(f, "date"),
                  currency: "USD",
                  nextPayday: field(f, "next"),
                  commitmentsConfirmed: false,
                });
                setSelected(id);
              })
            }
          >
            <label>
              Income source
              <select name="source" required>
                {ledger.sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Paycheck status
              <select name="state">
                <option value="received">Arrived</option>
                <option value="expected">Expected future paycheck</option>
              </select>
            </label>
            <label>
              Posted deposit (for arrived paycheck)
              <select name="deposit">
                <option value="">Choose deposit</option>
                {data.evidence.transactions
                  .filter(
                    (t: any) =>
                      !t.pending &&
                      t.amount.startsWith("-") &&
                      t.currency === "USD" &&
                      !ledger.paychecks.some((p) => p.transactionId === t.id),
                  )
                  .map((t: any) => (
                    <option key={t.id} value={t.id}>
                      {t.date} ·{" "}
                      {
                        data.evidence.accounts.find(
                          (a: any) => a.id === t.accountId,
                        )?.name
                      }{" "}
                      · {t.name} · ${t.amount.slice(1)}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Expected amount (future paycheck only)
              <input name="amount" inputMode="decimal" />
            </label>
            <label>
              Expected arrival (future paycheck only)
              <input name="date" type="date" />
            </label>
            <label>
              Following payday for this source
              <input name="next" type="date" required />
            </label>
            <button>Add paycheck</button>
          </form>
        </details>
      </section>
      {selectedPaycheck && (
        <>
          <section className="panel">
            <h2>
              {
                ledger.sources.find((s) => s.id === selectedPaycheck.sourceId)
                  ?.name
              }{" "}
              · {selectedPaycheck.date}
            </h2>
            <p>
              {reviewMoney(selectedPaycheck.amountMinor)} ·{" "}
              {selectedPaycheck.state === "expected"
                ? "Future income: never safe to spend"
                : "Received paycheck"}
            </p>
            <label>
              Next payday
              <input
                type="date"
                value={selectedPaycheck.nextPayday}
                onChange={(e) =>
                  patch("paychecks", {
                    ...selectedPaycheck,
                    nextPayday: e.target.value,
                    commitmentsConfirmed: false,
                  })
                }
              />
            </label>
            <label className="review-check">
              <input
                type="checkbox"
                checked={selectedPaycheck.commitmentsConfirmed}
                onChange={(e) =>
                  patch("paychecks", {
                    ...selectedPaycheck,
                    commitmentsConfirmed: e.target.checked,
                  })
                }
              />
              I have included predictable commitments and all card spending
              already incurred. Statement amounts exclude payments already
              recorded here.
            </label>
            <p>
              Check bank debits since this deposit too. Unrecorded spending
              makes the remaining amount unreliable.
            </p>
          </section>
          {selectedPaycheck.state === "expected" && (
            <section className="panel">
              <h2>This paycheck arrived</h2>
              <form
                onSubmit={(e) =>
                  submit(e, (f) => {
                    const t = data.evidence.transactions.find(
                      (t: any) => t.id === field(f, "deposit"),
                    );
                    if (!t) throw Error("Choose the posted deposit.");
                    patch("paychecks", {
                      ...selectedPaycheck,
                      state: "received",
                      transactionId: t.id,
                      date: t.date,
                      amountMinor: parseReviewMoney(t.amount.slice(1)),
                      commitmentsConfirmed: false,
                    });
                  })
                }
              >
                <label>
                  Actual posted deposit
                  <select name="deposit" required>
                    <option value="">Choose deposit</option>
                    {data.evidence.transactions
                      .filter(
                        (t: any) =>
                          !t.pending &&
                          t.amount.startsWith("-") &&
                          t.accountId ===
                            ledger.sources.find(
                              (s) => s.id === selectedPaycheck.sourceId,
                            )?.accountId &&
                          !ledger.paychecks.some(
                            (p) => p.transactionId === t.id,
                          ),
                      )
                      .map((t: any) => (
                        <option key={t.id} value={t.id}>
                          {t.date} · {t.name} · ${t.amount.slice(1)}
                        </option>
                      ))}
                  </select>
                </label>
                <button>Confirm arrival and review actual amount</button>
              </form>
              <p>
                Existing funding promises stay attached. If the amount or timing
                changed, correct those assignments before saving.
              </p>
            </section>
          )}
          {projection && <ReviewSummary projection={projection} />}
          {sections && (
            <>
              <ReviewCommitments {...sections} />
              <ReviewCards {...sections} />
            </>
          )}
          <section className="panel">
            <h2>Add or correct an obligation</h2>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setShowObligation(true);
              }}
            >
              Add obligation
            </button>
            {showObligation && (
              <form
                key={editing?.id ?? "new"}
                onSubmit={(e) =>
                  submit(e, (f) => {
                    const amount = field(f, "amount");
                    patch("obligations", {
                      id: editing?.id ?? newId(),
                      kind: field(f, "kind"),
                      name: field(f, "name"),
                      accountId: field(f, "account"),
                      fundingSourceId:
                        field(f, "kind") === "commitment"
                          ? selectedPaycheck.sourceId
                          : null,
                      planId: field(f, "plan") || null,
                      statementKey: field(f, "cycle") || null,
                      amountMinor: amount ? parseReviewMoney(amount) : null,
                      currency: "USD",
                      dueDate: field(f, "due") || null,
                      neededBy: field(f, "needed") || null,
                      basis: "manual",
                      confirmed: f.get("confirmed") === "on",
                    });
                    setShowObligation(false);
                    setEditing(null);
                  })
                }
              >
                <label>
                  Kind
                  <select
                    name="kind"
                    defaultValue={editing?.kind ?? "commitment"}
                  >
                    <option value="commitment">
                      Predictable commitment paid from cash
                    </option>
                    <option value="statement">
                      Last credit card statement
                    </option>
                    <option value="unbilled">
                      Purchases for next credit card statement
                    </option>
                  </select>
                </label>
                <label>
                  Name
                  <input
                    name="name"
                    required
                    maxLength={150}
                    defaultValue={editing?.name}
                  />
                </label>
                <label>
                  Payment account or card
                  <select
                    name="account"
                    defaultValue={
                      editing?.accountId ??
                      ledger.sources.find(
                        (s) => s.id === selectedPaycheck.sourceId,
                      )?.accountId
                    }
                  >
                    {data.evidence.accounts.map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {a.name} · {a.type ?? "unknown"}
                        {a.included ? "" : " · hidden"}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Existing commitment (optional)
                  <select name="plan" defaultValue={editing?.planId ?? ""}>
                    <option value="">Manual obligation</option>
                    {data.evidence.plans.map((p: any) => (
                      <option key={p.id} value={p.id}>
                        {p.name} · {p.accountName} · {p.frequency} · day{" "}
                        {p.day ?? "unknown"}
                      </option>
                    ))}
                  </select>
                </label>
                <p>
                  Use planned commitments as a reference. Confirm the actual due
                  amount and date; monthly estimates are not payment deadlines.
                  Purchases paid by card belong in the card total, not here
                  again.
                </p>
                <label>
                  Card cycle label (unique per card)
                  <input
                    name="cycle"
                    placeholder="2026-11 statement"
                    defaultValue={editing?.statementKey ?? ""}
                  />
                </label>
                <label>
                  Total amount before payments recorded in this review
                  <input
                    name="amount"
                    inputMode="decimal"
                    defaultValue={
                      editing?.amountMinor == null
                        ? ""
                        : formatReviewMoney(editing.amountMinor)
                    }
                  />
                </label>
                <label>
                  Due date
                  <input
                    name="due"
                    type="date"
                    defaultValue={editing?.dueDate ?? ""}
                  />
                </label>
                <label>
                  Funding needed by
                  <input
                    name="needed"
                    type="date"
                    defaultValue={editing?.neededBy ?? ""}
                  />
                </label>
                <p>
                  Allow time for your payment route. A later paycheck must
                  arrive by this date to help.
                </p>
                <label className="review-check">
                  <input
                    type="checkbox"
                    name="confirmed"
                    defaultChecked={editing?.confirmed}
                  />
                  I confirmed this amount, dates, and that it does not overlap
                  another obligation.
                </label>
                <button>Apply obligation</button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setShowObligation(false)}
                >
                  Cancel
                </button>
              </form>
            )}
          </section>
          <details className="panel">
            <summary>Other cash spending and payment corrections</summary>
            <p>
              Record direct spending from this paycheck that is not already a
              reserved obligation. Link card payments through their obligation
              above.
            </p>
            <form
              onSubmit={(e) =>
                submit(e, (f) => {
                  const t = data.evidence.transactions.find(
                    (t: any) => t.id === field(f, "tx"),
                  );
                  if (!t) throw Error("Choose a posted debit.");
                  patch("settlements", {
                    id: newId(),
                    paycheckId: selected,
                    obligationId: null,
                    contributionId: null,
                    amountMinor: parseReviewMoney(t.amount),
                    transactionIds: [t.id],
                    confirmed: true,
                  });
                })
              }
            >
              <label>
                Posted debit
                <select name="tx" required>
                  <option value="">Choose transaction</option>
                  {data.evidence.transactions
                    .filter(
                      (t: any) =>
                        !t.pending &&
                        !t.amount.startsWith("-") &&
                        t.accountId ===
                          ledger.sources.find(
                            (s) => s.id === selectedPaycheck.sourceId,
                          )?.accountId &&
                        !ledger.settlements.some((s) =>
                          s.transactionIds.includes(t.id),
                        ),
                    )
                    .map((t: any) => (
                      <option key={t.id} value={t.id}>
                        {t.date} · {t.name} · ${t.amount}
                      </option>
                    ))}
                </select>
              </label>
              <button>Record direct spending</button>
            </form>
            {ledger.settlements
              .filter((s) => s.paycheckId === selected)
              .map((s) => (
                <p key={s.id}>
                  {reviewMoney(s.amountMinor)} ·{" "}
                  {s.obligationId ? "Obligation payment" : "Direct spending"}{" "}
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      run(() => {
                        if (
                          confirm(
                            "Remove this recorded payment? Its reservation will become outstanding again.",
                          )
                        )
                          setLedger({
                            ...ledger,
                            settlements: ledger.settlements.filter(
                              (v) => v.id !== s.id,
                            ),
                          });
                      })
                    }
                  >
                    Remove recorded payment
                  </button>
                </p>
              ))}
          </details>
          <section className="panel">
            <div className="actions">
              <button disabled={busy} onClick={() => void save()}>
                Save review
              </button>
              <button
                disabled={
                  busy ||
                  !projection ||
                  projection.safeToSpendMinor === null ||
                  selectedPaycheck.state !== "received"
                }
                onClick={() => void save(true)}
              >
                Finish review
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  if (
                    !dirty ||
                    confirm("Discard unsaved review changes and reload?")
                  )
                    void load();
                }}
              >
                Reload saved review
              </button>
            </div>
            <p>
              {dirty ? "Unsaved changes." : "Saved inputs."} Reservations do not
              transfer money or pay bills. Finishing records your review; a
              shortfall remains a shortfall.
            </p>
          </section>
        </>
      )}
      <details className="panel">
        <summary>Earlier paycheck leftovers</summary>
        {ledger.paychecks
          .filter(
            (p) =>
              p.id !== selected &&
              p.state === "received" &&
              p.nextPayday <= data.asOf,
          )
          .map((p) => {
            const r = previewReview(ledger, p.id, data.asOf);
            return (
              <p key={p.id}>
                {ledger.sources.find((s) => s.id === p.sourceId)?.name} ·{" "}
                {p.date}: {reviewMoney(r.leftoverMinor)} available to put aside,
                separate from this paycheck.
              </p>
            );
          })}
      </details>
      <p>
        <a href="#budget">Manage planned commitments</a> ·{" "}
        <a href="#accounts">Review bank data</a>
      </p>
    </>
  );
}
