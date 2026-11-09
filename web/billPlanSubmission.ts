export function billPlanSubmission(
  row: any,
  values: FormData,
  month: string,
  status: string,
) {
  const paymentDate = String(values.get("paymentDate") ?? ""),
    paymentAmount = String(values.get("paymentAmount") ?? ""),
    actualTransactionKey = String(values.get("actualTransactionKey") ?? "");
  if (
    (paymentDate || paymentAmount || actualTransactionKey) &&
    (!paymentDate || !paymentAmount || paymentDate.slice(0, 7) !== month)
  )
    throw Error(
      "Enter a payment date in the selected month and its known amount, or clear all payment fields.",
    );
  return {
    ...row,
    name: values.get("name"),
    accountName: values.get("accountName"),
    amount: values.get("amount"),
    amountMode: values.get("amountMode"),
    planningEstimate: values.get("planningEstimate"),
    expenseType: values.get("expenseType"),
    creditAccountId: values.get("creditAccountId") ?? "",
    currency: values.get("currency"),
    frequency: values.get("frequency"),
    day: values.get("day") ? Number(values.get("day")) : null,
    notes: values.get("notes"),
    kind: values.get("kind"),
    acknowledgeDuplicate: values.get("duplicate") === "on",
    status,
    payments: [
      ...(row.payments ?? []).filter((p: any) => p.date.slice(0, 7) !== month),
      ...(paymentDate
        ? [
            {
              date: paymentDate,
              amount: paymentAmount,
              ...(actualTransactionKey ? { actualTransactionKey } : {}),
            },
          ]
        : []),
    ],
  };
}
