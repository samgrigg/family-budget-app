import { isCreditCardPayment } from "../shared/billAmounts";
import { useState } from "react";
export default function BillClassificationFields({
  expenseType = "expense",
  creditAccountId = "",
  accounts,
}: {
  expenseType?: string;
  creditAccountId?: string;
  accounts: { id: string; name: string }[];
}) {
  const [classification, setClassification] = useState(expenseType);
  const [card, setCard] = useState(creditAccountId);
  return (
    <>
      <label>
        Counts as
        <select
          name="expenseType"
          value={classification}
          onChange={(e) => setClassification(e.target.value)}
        >
          <option value="expense">Expense</option>
          <option value="creditPayment">Credit card payment (purchases)</option>
          <option value="creditDebtPayoff">
            Credit card payment (debt payoff)
          </option>
        </select>
      </label>
      {isCreditCardPayment(classification) && (
        <label>
          Credit card being paid (optional)
          <select
            name="creditAccountId"
            value={card}
            onChange={(e) => setCard(e.target.value)}
          >
            <option value="">Card account not linked</option>
            {card && !accounts.some((a) => a.id === card) && (
              <option value={card}>
                Previously selected card · unavailable
              </option>
            )}
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
