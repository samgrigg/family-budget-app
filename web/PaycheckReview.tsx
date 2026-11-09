import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import ExpectedAmountField from "./ExpectedAmountField";
import { expectedPaycheck } from "./expectedPaycheck";
import { paycheckDeposits } from "./paycheckDeposits";
import IncomeSourceSetup from "./IncomeSourceSetup";
import { saveIncomeSource } from "./saveIncomeSource";
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
    [depositSourceId, setDepositSourceId] = useState(""),
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
        <Button onClick={() => void load()} disabled={busy}>
          Retry
        </Button>
      </section>
    );
  const depositSource =
    ledger.sources.find((s) => s.id === depositSourceId) ?? ledger.sources[0];
  const availableDeposits = paycheckDeposits(
    ledger,
    data.evidence.transactions,
    depositSource?.id ?? "",
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
      <p role="status" className="action-status">
        {notice}
      </p>
      {error && (
        <Alert variant="destructive" className="review-alert">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {projection && (
        <ReviewSummary
          projection={projection}
          context={`${ledger.sources.find((s) => s.id === selectedPaycheck?.sourceId)?.name ?? "Paycheck"} · ${selectedPaycheck?.date ?? ""}`}
        />
      )}
      <section className="panel">
        <h2>Start or resume</h2>
        <Label>
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
        </Label>
        <IncomeSourceSetup
          sources={ledger.sources}
          accounts={data.evidence.accounts}
          busy={busy}
          onSave={async (source) => {
            setBusy(true);
            try {
              const saved = await saveIncomeSource(api, data, ledger, source);
              setData(saved.data);
              setLedger((current) =>
                current
                  ? {
                      ...current,
                      revision: saved.ledger.revision,
                      sources: saved.ledger.sources,
                    }
                  : saved.ledger,
              );
              return saved.data.idMap?.[source.id] ?? source.id;
            } finally {
              setBusy(false);
            }
          }}
        />

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
            <Label>
              Income source
              <select
                name="source"
                required
                value={depositSource?.id ?? ""}
                onChange={(e) => setDepositSourceId(e.target.value)}
              >
                {ledger.sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Label>
            <Label>
              Paycheck status
              <select name="state">
                <option value="received">Arrived</option>
                <option value="expected">Expected future paycheck</option>
              </select>
            </Label>
            <Label>
              Posted deposit (for arrived paycheck)
              <select
                name="deposit"
                key={`${depositSource?.id}:${depositSource?.accountId}`}
                defaultValue=""
                disabled={!depositSource}
              >
                <option value="">Choose deposit</option>
                {availableDeposits.map((t: any) => (
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
            </Label>
            <p role="status" className="action-status">
              {depositSource
                ? `Showing unused posted USD deposits into ${data.evidence.accounts.find((a: any) => a.id === depositSource.accountId)?.name ?? "the mapped account"}.`
                : "Set up an income source first."}
              {depositSource && availableDeposits.length === 0
                ? " No eligible deposits found. Check account history or sync in Accounts."
                : ""}
            </p>
            <ExpectedAmountField
              key={`${depositSource?.id}:${depositSource?.accountId}`}
              name="amount"
              label="Expected amount (future paycheck only)"
              suggestion={expectedPaycheck(
                ledger,
                data.evidence.transactions,
                depositSource?.id ?? "",
                data.asOf,
              )}
            />
            <Label>
              Expected arrival (future paycheck only)
              <Input name="date" type="date" />
            </Label>
            <Label>
              Following payday for this source
              <Input name="next" type="date" required />
            </Label>
            <Button>Add paycheck</Button>
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
              <Button
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
              </Button>
              <Button
                disabled={busy || dirty}
                variant="outline"
                onClick={() => {
                  void onCardConsent(source.id).catch((e) =>
                    setError(e.message),
                  );
                }}
              >
                Authorize card data
              </Button>
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
              <Button
                variant="outline"
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
              </Button>
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
            <Label>
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
            </Label>
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
                <ExpectedAmountField
                  key={selectedPaycheck.id}
                  name="expectedAmount"
                  label="Expected amount"
                  initialAmount={selectedPaycheck.amountMinor}
                  suggestion={expectedPaycheck(
                    ledger,
                    data.evidence.transactions,
                    selectedPaycheck.sourceId,
                    data.asOf,
                  )}
                />

                <Label>
                  Expected arrival date
                  <Input
                    name="expectedDate"
                    type="date"
                    defaultValue={selectedPaycheck.date}
                    required
                  />
                </Label>
                <Button>Update expected paycheck</Button>
              </form>
            )}
            <Label className="review-check">
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
            </Label>
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
                <Label>
                  Actual posted deposit
                  <select name="deposit" required>
                    <option value="">Choose deposit</option>
                    {paycheckDeposits(
                      ledger,
                      data.evidence.transactions,
                      selectedPaycheck.sourceId,
                      selectedPaycheck.id,
                    ).map((t: any) => (
                      <option key={t.id} value={t.id}>
                        {t.date} · {t.name} · ${t.amount.slice(1)}
                      </option>
                    ))}
                  </select>
                </Label>
                <Button>Confirm arrival and review actual amount</Button>
              </form>
              <p>
                Existing funding promises stay attached. If the amount or timing
                changed, correct those assignments before saving.
              </p>
            </section>
          )}

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
            <Button
              type="button"
              onClick={() => {
                setEditing(null);
                setShowObligation(true);
              }}
            >
              Add obligation
            </Button>
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
              <Label>
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
              </Label>
              <Button>Record cash used</Button>
            </form>
            {ledger.settlements
              .filter((s) => s.paycheckId === selected)
              .map((s) => (
                <p key={s.id}>
                  {reviewMoney(s.amountMinor)} ·{" "}
                  {s.obligationId ? "Obligation payment" : "Other cash used"}{" "}
                  <Button
                    type="button"
                    variant="outline"
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
                  </Button>
                </p>
              ))}
          </details>
          <section className="panel">
            <div className="actions">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void save()}
              >
                Save review
              </Button>
              <Button
                disabled={
                  busy ||
                  !projection ||
                  projection.safeToSpendMinor === null ||
                  selectedPaycheck.state !== "received"
                }
                onClick={() => void save(true)}
              >
                Finish review
              </Button>
              <Button
                variant="outline"
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
              </Button>
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
