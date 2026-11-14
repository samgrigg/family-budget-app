// A view owns one gate. New refreshes supersede older reads; route unmount
// invalidates every pending completion, including mutations and pagination.
export function createRequestGate() {
  let generation = 0;
  let active = true;
  return {
    begin() {
      const request = ++generation;
      return () => active && request === generation;
    },
    active: () => active,
    dispose() {
      active = false;
      generation++;
    },
  };
}
export async function loadAccountView(
  api: (path: string) => Promise<any>,
  accountId: string,
  gate: ReturnType<typeof createRequestGate>,
  accept: (view: { index: any; detail: any }) => void,
  reject: (error: Error) => void,
) {
  const current = gate.begin();
  try {
    const [index, detail] = await Promise.all([
      api("/accounts"),
      accountId
        ? api(`/accounts/${encodeURIComponent(accountId)}`)
        : Promise.resolve(null),
    ]);
    if (detail && detail.account.id !== accountId)
      throw Error(
        "The account response did not match this page. Retry loading.",
      );
    if (current()) accept({ index, detail });
  } catch (error) {
    if (current()) reject(error as Error);
  }
}
export function accountAmount(currency: string, amount: string) {
  // Provider values remain unchanged for reconciliation and analysis.
  const value = -Number(amount);
  if (!Number.isFinite(value)) return "Amount unavailable";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  const label =
    currency === "USD" ? "$" : currency ? `${currency} ` : "Currency unknown ";
  return `${sign}${label}${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export async function appendAccountPage(
  api: (path: string) => Promise<any>,
  detail: any,
  gate: ReturnType<typeof createRequestGate>,
  accept: (detail: any) => void,
) {
  const current = gate.begin();
  const next = await api(
    `/accounts/${encodeURIComponent(detail.account.id)}?cursor=${encodeURIComponent(detail.nextCursor)}`,
  );
  if (!current()) return;
  if (next.account.id !== detail.account.id)
    throw Error(
      "The transaction page did not match this account. Retry loading.",
    );
  accept({
    ...next,
    transactions: [...detail.transactions, ...next.transactions],
  });
}
export async function saveAccountPreferences(
  api: (path: string, body: any) => Promise<any>,
  routeId: string,
  displayedId: string,
  gate: ReturnType<typeof createRequestGate>,
  preferences: { name: FormDataEntryValue | null; included: boolean },
) {
  if (!gate.active() || routeId !== displayedId)
    throw Error("The account page changed. Reload before saving.");
  await api(
    `/accounts/${encodeURIComponent(routeId)}/preferences`,
    preferences,
  );
}
