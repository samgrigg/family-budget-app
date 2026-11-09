export function billPlanSubmission(
  row: any,
  values: FormData,
  month: string,
  status: string,
) {
  const expectedChargeCount = Number(
    values.get("expectedChargeCount") ?? row.expectedChargeCount ?? 1,
  );
  const labels = values.getAll("chargeLabel");
  const existing = row.payments?.find((p: any) => p.date.slice(0, 7) === month);
  const charges = values
    .getAll("chargeKey")
    .map((key, i) => ({
      ...existing?.charges?.find((c: any) => c.key === key),
      key: String(key),
      label: String(labels[i] ?? ""),
    }))
    .filter((c) => c.key);
  const grouped =
    expectedChargeCount > 1 ||
    values.get("groupedCharges") === "on" ||
    values.has("chargeKey");
  let paymentDate = String(values.get("paymentDate") ?? ""),
    paymentAmount = String(values.get("paymentAmount") ?? ""),
    actualTransactionKey = grouped
      ? ""
      : String(values.get("actualTransactionKey") ?? "");
  if (grouped && charges.length && !paymentDate) paymentDate = `${month}-01`;
  // A default full amount alone does not create a cycle.
  if (grouped && !paymentDate && !charges.length) paymentAmount = "";
  if (
    (paymentDate || paymentAmount || actualTransactionKey) &&
    (!paymentDate || !paymentAmount || paymentDate.slice(0, 7) !== month)
  )
    throw Error(
      "Enter a payment date in the selected month and its known amount, or clear all payment fields.",
    );
  return {
    ...row,
    expectedChargeCount,
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
              ...(grouped ? { expectedChargeCount, charges } : {}),
              ...(actualTransactionKey ? { actualTransactionKey } : {}),
            },
          ]
        : []),
    ],
  };
}
