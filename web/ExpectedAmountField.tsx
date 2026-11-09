import React, { useId, useState } from "react";
import type { PaycheckSuggestion } from "./expectedPaycheck";
import { formatReviewMoney } from "../shared/reviewMoney";
export default function ExpectedAmountField({
  suggestion,
  name,
  label,
  initialAmount,
}: {
  suggestion: PaycheckSuggestion | null;
  name: string;
  label: string;
  initialAmount?: number;
}) {
  const helpId = useId();
  const [value, setValue] = useState(() =>
    initialAmount !== undefined
      ? formatReviewMoney(initialAmount)
      : suggestion
        ? formatReviewMoney(suggestion.amountMinor)
        : "",
  );
  return (
    <>
      <label>
        {label}
        <input
          name={name}
          inputMode="decimal"
          required={initialAmount !== undefined}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-describedby={helpId}
        />
      </label>
      <p id={helpId}>
        {suggestion ? (
          <>
            Suggested ${formatReviewMoney(suggestion.amountMinor)} from{" "}
            {suggestion.sampleSize === 1
              ? "one confirmed paycheck"
              : `the median of ${suggestion.sampleSize} recent confirmed paychecks`}
            .{" "}
            {suggestion.varies
              ? `Amounts vary: $${formatReviewMoney(suggestion.minMinor)}–$${formatReviewMoney(suggestion.maxMinor)}. Check this estimate carefully. `
              : ""}
            You can edit this amount. Future income is excluded from safe to
            spend.
          </>
        ) : (
          <>
            No confirmed paycheck history for this source yet. Enter an expected
            amount; other deposits are not assumed to be payroll.
          </>
        )}
      </p>
      {suggestion && (
        <button
          type="button"
          className="secondary"
          onClick={() => setValue(formatReviewMoney(suggestion.amountMinor))}
        >
          Use suggested amount
        </button>
      )}
    </>
  );
}
