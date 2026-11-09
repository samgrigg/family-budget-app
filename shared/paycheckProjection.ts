import type { ReviewLedger, ReviewProjection } from "./paycheckReview";
export function projectReview(
  l: ReviewLedger,
  paycheckId: string,
  asOf: string,
): ReviewProjection {
  const p = l.paychecks.find((p) => p.id === paycheckId);
  if (!p) throw Error("Paycheck not found.");
  const issues: ReviewProjection["issues"] = [];
  const issue = (code: string, recordId: string, message: string) =>
    issues.push({ code, recordId, message });
  if (p.currency !== "USD")
    issue("CURRENCY", p.id, "Only USD reviews are supported.");
  if (!p.commitmentsConfirmed)
    issue("COMMITMENTS", p.id, "Confirm commitments for this paycheck.");
  const paid = l.settlements.filter((s) => s.confirmed);
  const used = new Set<string>();
  for (const s of paid)
    for (const id of s.transactionIds) {
      if (used.has(id))
        issue(
          "DUPLICATE_PAYMENT",
          s.id,
          "A payment is assigned more than once.",
        );
      used.add(id);
    }
  const capacities = new Map<string, number>();
  for (const pay of l.paychecks) {
    const spent = paid
      .filter((s) => s.paycheckId === pay.id)
      .reduce((n, s) => n + s.amountMinor, 0);
    let reserved = 0;
    for (const c of l.contributions.filter((c) => c.paycheckId === pay.id)) {
      const consumed = paid
        .filter((s) => s.contributionId === c.id)
        .reduce((n, s) => n + s.amountMinor, 0);
      if (consumed > c.amountMinor)
        issue("SETTLEMENT_EXCESS", c.id, "Payment exceeds its reservation.");
      reserved += Math.max(0, c.amountMinor - consumed);
    }
    const remaining = pay.amountMinor - spent - reserved;
    capacities.set(pay.id, remaining);
    if (remaining < 0)
      issue(
        "OVERALLOCATED",
        pay.id,
        "This paycheck is promised more than it contains.",
      );
  }
  let paymentShortfallMinor = 0,
    futureRelianceMinor = 0,
    unassignedCardMinor = 0;
  const relevant = l.obligations.filter(
    (o) =>
      o.kind !== "commitment" ||
      (o.fundingSourceId === p.sourceId &&
        (!o.dueDate || o.dueDate <= p.nextPayday)),
  );
  const obligationCoverage: ReviewProjection["obligationCoverage"] = [];
  for (const o of relevant) {
    if (o.currency !== p.currency) {
      issue("CURRENCY", o.id, "Review this currency separately.");
      continue;
    }
    if (!o.confirmed || o.amountMinor === null || !o.dueDate || !o.neededBy)
      issue(
        "UNKNOWN",
        o.id,
        "Confirm the amount, due date, and funding deadline.",
      );
    const paidMinor = paid
      .filter((s) => s.obligationId === o.id)
      .reduce((n, s) => n + s.amountMinor, 0);
    let cashMinor = 0,
      futureMinor = 0;
    for (const c of l.contributions.filter((c) => c.obligationId === o.id)) {
      const pay = l.paychecks.find((p) => p.id === c.paycheckId);
      const consumed = paid
        .filter((s) => s.contributionId === c.id)
        .reduce((n, s) => n + s.amountMinor, 0);
      const amount = Math.max(0, c.amountMinor - consumed);
      if (
        !pay ||
        pay.currency !== o.currency ||
        !o.neededBy ||
        c.neededBy > o.neededBy ||
        pay.date > c.neededBy ||
        !pay.commitmentsConfirmed
      ) {
        issue(
          "INELIGIBLE",
          c.id,
          "Funding must be available before the payment deadline.",
        );
        continue;
      }
      if ((capacities.get(pay.id) ?? -1) < 0) continue;
      if (pay.state === "received" && pay.date <= asOf) cashMinor += amount;
      else futureMinor += amount;
    }
    const remaining =
      o.amountMinor === null ? null : Math.max(0, o.amountMinor - paidMinor);
    const uncoveredMinor =
      remaining === null
        ? null
        : Math.max(0, remaining - cashMinor - futureMinor);
    if (remaining !== null && cashMinor + futureMinor > remaining)
      issue("EXCESS_FUNDING", o.id, "Funding exceeds the unpaid obligation.");
    obligationCoverage.push({
      obligationId: o.id,
      cashMinor,
      futureMinor,
      paidMinor,
      uncoveredMinor,
    });
    if (o.kind !== "commitment") {
      futureRelianceMinor += Math.min(
        futureMinor,
        Math.max(0, (remaining ?? 0) - cashMinor),
      );
      unassignedCardMinor += uncoveredMinor ?? 0;
    }
    if (o.dueDate && o.dueDate <= p.nextPayday)
      paymentShortfallMinor += uncoveredMinor ?? 0;
  }
  const remaining = capacities.get(p.id) ?? 0;
  if (futureRelianceMinor > 0 && remaining > 0)
    issue(
      "CURRENT_FIRST",
      p.id,
      "Reserve available current cash before relying on future paychecks.",
    );
  const uncertain =
    issues.some((i) =>
      [
        "CURRENCY",
        "COMMITMENTS",
        "UNKNOWN",
        "INELIGIBLE",
        "DUPLICATE_PAYMENT",
        "SETTLEMENT_EXCESS",
        "CURRENT_FIRST",
        "EXCESS_FUNDING",
      ].includes(i.code),
    ) ||
    (unassignedCardMinor > 0 && paymentShortfallMinor === 0);
  const safeToSpendMinor =
    p.state !== "received" || p.date > asOf || uncertain
      ? null
      : Math.max(0, remaining - paymentShortfallMinor);
  return {
    paycheckId,
    safeToSpendMinor,
    paymentShortfallMinor,
    futureRelianceMinor,
    unassignedCardMinor,
    leftoverMinor: asOf >= p.nextPayday ? safeToSpendMinor : null,
    issues,
    obligationCoverage,
  };
}
