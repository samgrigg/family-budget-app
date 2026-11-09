import ReviewObligationForm from "./ReviewObligationForm";
import {
  unassignedPurchases,
  unassignedCashDebits,
} from "../shared/reviewPurchases";
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
  onCardConsent,
}: {
  api: (path: string, body?: any) => Promise<any>;
  onCardConsent: (sourceId: string) => Promise<void>;
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
  useEffect(() => {
    if (showObligation)
      requestAnimationFrame(() => {
        const form = document.getElementById("review-obligation-form");
        form?.scrollIntoView({ block: "start" });
        form?.querySelector<HTMLElement>("select")?.focus();
      });
  }, [showObligation, editing?.id]);
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
  const unassigned = unassignedPurchases(
    ledger,
    data.evidence.transactions,
    data.evidence.accounts,
  );
  const unassignedCash = unassignedCashDebits(
    ledger,
    data.evidence.transactions,
  ).filter((t) => t.paycheckId === selected);
  if (projection) {
    const server = data.projections.find((p: any) => p.paycheckId === selected);
    if (
      (!dirty &&
        server?.issues.some((i: any) => i.code === "EVIDENCE_CHANGED")) ||
      data.evidence.issues.length ||
      unassignedCash.length ||
      unassigned.length
    ) {
      projection.safeToSpendMinor = null;
      projection.leftoverMinor = null;
      projection.issues.push({
        code: "EVIDENCE_CHANGED",
        recordId: selected,
        message: unassigned.length
          ? "Assign imported card purchases to an obligation before using safe to spend."
          : "Bank or plan evidence needs confirmation. Review the data and save again.",
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
                  id: field(f, "existingSource") || newId(),
                  name: field(f, "name"),
                  accountId: field(f, "account"),
                  incomeKey: null,
                }),
              )
            }
          >
            <label>
              Income source to add or correct
              <select name="existingSource">
                <option value="">New income source</option>
                {ledger.sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
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
                      !ledger.paychecks.some(
                        (p) => p.id !== selected && p.transactionId === t.id,
                      ),
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
      <details className="panel">
        <summary>Card statement data</summary>
        <p>
          Refresh supported card data on request. It may be cached by your bank.
          Confirm the unpaid amount after payments; the original statement
          balance is not necessarily still owed.
        </p>
        {data.cardSources?.map((source: any) => (
          <div className="bill" key={source.id}>
            <h3>{source.name}</h3>
            <div className="actions">
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const r = await api(
                      `/paycheck-review/card-data/${encodeURIComponent(source.id)}/refresh`,
                      {},
                    );
                    setData({ ...data, cardData: r.cardData });
                    setNotice(
                      "Card suggestions refreshed. Confirm the amounts before applying them.",
                    );
                  } catch (e: any) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Refresh card data
              </button>
              <button
                disabled={busy || dirty}
                className="secondary"
                onClick={() => {
                  void onCardConsent(source.id).catch((e) =>
                    setError(e.message),
                  );
                }}
              >
                Authorize card data
              </button>
            </div>
            {dirty && (
              <p>Save this review before opening bank authorization.</p>
            )}
          </div>
        ))}
        {data.cardData?.map((c: any) => (
          <article className="bill" key={c.sourceId + c.accountId}>
            <h3>
              {data.evidence.accounts.find((a: any) => a.id === c.accountId)
                ?.name ?? "Card"}
            </h3>
            <p>
              Original statement {reviewMoney(c.statementBalanceMinor)} · Issued{" "}
              {c.statementDate ?? "unknown"} · Due{" "}
              {c.paymentDueDate ?? "unknown"}
            </p>
            <p>
              Retrieved {c.fetchedAt ?? "not yet"}
              {c.issue ? ` · ${c.issue}` : ""}
            </p>
            {selectedPaycheck && (
              <button
                className="secondary"
                onClick={() => {
                  setEditing({
                    id: newId(),
                    kind: "statement",
                    name: "Card statement",
                    accountId: c.accountId,
                    fundingSourceId: null,
                    planId: null,
                    statementKey: c.statementDate ?? null,
                    amountMinor: c.statementBalanceMinor,
                    currency: "USD",
                    dueDate: c.paymentDueDate,
                    neededBy: null,
                    basis: "provider",
                    confirmed: false,
                  });
                  setShowObligation(true);
                }}
              >
                Review statement suggestion
              </button>
            )}
          </article>
        ))}
      </details>
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
            {selectedPaycheck.state === "expected" && (
              <form
                onSubmit={(e) =>
                  submit(e, (f) =>
                    patch("paychecks", {
                      ...selectedPaycheck,
                      amountMinor: parseReviewMoney(field(f, "expectedAmount")),
                      date: field(f, "expectedDate"),
                      commitmentsConfirmed: false,
                    }),
                  )
                }
              >
                <label>
                  Expected amount
                  <input
                    name="expectedAmount"
                    inputMode="decimal"
                    defaultValue={formatReviewMoney(
                      selectedPaycheck.amountMinor,
                    )}
                    required
                  />
                </label>
                <label>
                  Expected arrival date
                  <input
                    name="expectedDate"
                    type="date"
                    defaultValue={selectedPaycheck.date}
                    required
                  />
                </label>
                <button>Update expected paycheck</button>
              </form>
            )}
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
          {(selectedPaycheck.state === "expected" ||
            data.projections
              .find((p: any) => p.paycheckId === selected)
              ?.issues.some((i: any) => i.code === "EVIDENCE_CHANGED")) && (
            <section className="panel">
              <h2>Confirm posted paycheck</h2>
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
          {unassigned.length > 0 && (
            <section className="panel">
              <h2>Card purchases to assign</h2>
              <p>
                Add or edit a card obligation below and select its imported
                purchases.
              </p>
              <ul>
                {unassigned.map((t) => (
                  <li key={t.id}>
                    {t.date} · {t.name} · ${t.amount}
                    {t.pending ? " · pending" : ""}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {unassignedCash.length > 0 && (
            <section className="panel">
              <h2>Cash movements to review</h2>
              <p>
                Record an obligation payment above or other cash use below.
                These posted debits are not yet accounted for.
              </p>
              <ul>
                {unassignedCash.map((t) => (
                  <li key={t.id}>
                    {t.date} · {t.name} · ${t.amount}
                  </li>
                ))}
              </ul>
            </section>
          )}
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
              <ReviewObligationForm
                editing={editing}
                ledger={ledger}
                selectedPaycheck={selectedPaycheck}
                data={data}
                submit={submit}
                patch={patch}
                onDone={() => {
                  setShowObligation(false);
                  setEditing(null);
                }}
              />
            )}
          </section>
          <details className="panel">
            <summary>Other cash use and payment corrections</summary>
            <p>
              Record cash used or moved aside from this paycheck that is not
              already a reserved obligation. Link card payments through their
              obligation above.
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
              <button>Record cash used</button>
            </form>
            {ledger.settlements
              .filter((s) => s.paycheckId === selected)
              .map((s) => (
                <p key={s.id}>
                  {reviewMoney(s.amountMinor)} ·{" "}
                  {s.obligationId ? "Obligation payment" : "Other cash used"}{" "}
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
