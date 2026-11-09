import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ReviewProjection } from "../shared/paycheckReview";
import { formatReviewMoney } from "../shared/reviewMoney";
export const reviewMoney = (n: number | null) =>
  n === null ? "Needs information" : `$${formatReviewMoney(n)}`;
export default function ReviewSummary({
  projection: p,
  context,
}: {
  projection: ReviewProjection;
  context?: string;
}) {
  const state =
    p.safeToSpendMinor === null
      ? "Needs review"
      : p.paymentShortfallMinor > 0
        ? "Payment shortfall"
        : p.futureRelianceMinor > 0
          ? "Future funding planned"
          : "Cash accounted for";
  return (
    <section className="review-result" aria-label="Review result">
      <Card className="review-summary-card">
        <CardContent className="review-summary-content">
          <div className="review-summary-lead">
            {context && <p className="review-context">{context}</p>}
            <div className="review-summary-heading">
              <h2>Safe to spend</h2>
              <Badge variant="outline">{state}</Badge>
            </div>
            <strong
              className={`review-total${p.safeToSpendMinor === null ? " review-total-unknown" : ""}`}
              aria-live="polite"
            >
              {reviewMoney(p.safeToSpendMinor)}
            </strong>
            <p>
              From this paycheck after commitments and card reservations. Future
              paychecks are excluded.
            </p>
          </div>
          <dl className="review-metrics">
            <div>
              <dt>Payment shortfall before next payday</dt>
              <dd>{reviewMoney(p.paymentShortfallMinor)}</dd>
            </div>
            <div>
              <dt>Future paycheck reliance</dt>
              <dd>{reviewMoney(p.futureRelianceMinor)}</dd>
            </div>
            <div>
              <dt>Card spending still unassigned</dt>
              <dd>{reviewMoney(p.unassignedCardMinor)}</dd>
            </div>
            {p.leftoverMinor !== null && (
              <div>
                <dt>Left over to put aside</dt>
                <dd>{reviewMoney(p.leftoverMinor)}</dd>
              </div>
            )}
          </dl>
        </CardContent>
        {(p.futureRelianceMinor > 0 || p.issues.length > 0) && (
          <div className="review-result-notes">
            {p.futureRelianceMinor > 0 && (
              <p>
                Some purchases already made need a future paycheck. Avoid this
                when current cash can cover them.
              </p>
            )}
            {p.issues.length > 0 && (
              <ul>
                {p.issues.map((i, n) => (
                  <li key={n}>{i.message}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Card>
    </section>
  );
}
