import React from "react";
import type { ReviewProjection } from "../shared/paycheckReview";
import { formatReviewMoney } from "../shared/reviewMoney";
export const reviewMoney = (n: number | null) =>
  n === null ? "Needs information" : `$${formatReviewMoney(n)}`;
export default function ReviewSummary({
  projection: p,
}: {
  projection: ReviewProjection;
}) {
  return (
    <section className="panel review-summary" aria-label="Review result">
      <h2>Safe to spend</h2>
      <strong className="review-total">
        {reviewMoney(p.safeToSpendMinor)}
      </strong>
      <p>
        From this paycheck after commitments and card reservations. Future
        paychecks are excluded.
      </p>
      <dl>
        <dt>Payment shortfall before next payday</dt>
        <dd>{reviewMoney(p.paymentShortfallMinor)}</dd>
        <dt>Future paycheck reliance</dt>
        <dd>{reviewMoney(p.futureRelianceMinor)}</dd>
        <dt>Card spending still unassigned</dt>
        <dd>{reviewMoney(p.unassignedCardMinor)}</dd>
        {p.leftoverMinor !== null && (
          <>
            <dt>Left over to put aside</dt>
            <dd>{reviewMoney(p.leftoverMinor)}</dd>
          </>
        )}
      </dl>
      {p.futureRelianceMinor > 0 && (
        <p>
          Some purchases already made need a future paycheck. Avoid this when
          current cash can cover them.
        </p>
      )}
      {p.issues.length > 0 && (
        <ul>
          {p.issues.map((i, n) => (
            <li key={n}>{i.message}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
