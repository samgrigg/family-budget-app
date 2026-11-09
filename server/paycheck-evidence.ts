import { createHash } from "node:crypto";
import type { Store } from "./store";
import { activePlanRecords, installBillPlan, type Plan } from "./bill-plan";
export function reviewEvidence(store: Store, drafts: Plan[]) {
  installBillPlan(store);
  const accounts = store.repository.listAccounts();
  const transactions = store.repository.analyticalHistory("all");
  const plans = activePlanRecords(store, drafts).filter(
    (p) => p.status === "confirmed" && p.kind === "bill",
  );
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        accounts: [...accounts].sort((a, b) => a.id.localeCompare(b.id)),
        transactions: [...transactions].sort((a, b) =>
          a.id.localeCompare(b.id),
        ),
        plans: [...plans].sort((a, b) => a.id.localeCompare(b.id)),
      }),
    )
    .digest("hex");
  return {
    accounts,
    transactions,
    plans,
    digest,
    issues: store.repository
      .dataIssues()
      .map((i: any) => ({
        code: "BANK_EVIDENCE",
        recordId: i.accountId ?? "",
        message: i.reason ?? "Bank evidence needs review.",
      })),
  };
}
