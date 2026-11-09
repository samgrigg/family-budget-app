import React from "react";
import { ObligationRow, type ReviewSectionsProps } from "./ReviewCommitments";
export default function ReviewCards(props: ReviewSectionsProps) {
  const rows = props.ledger.obligations.filter((o) => o.kind !== "commitment");
  return (
    <section className="panel">
      <h2>Credit card coverage</h2>
      <p>
        Shared across MACU and Etrade reviews. Reserve from current cash first.
        Statement and later purchases must be separate, non-overlapping amounts.
      </p>
      {rows.length ? (
        rows.map((o) => <ObligationRow key={o.id} o={o} props={props} />)
      ) : (
        <p>
          No card obligations entered. Confirm that all cards and purchases
          already made are accounted for before finishing.
        </p>
      )}
    </section>
  );
}
