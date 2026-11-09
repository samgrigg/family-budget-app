export const budgetTabs = [
  { id: "commitments", label: "Planned Commitments", panel: "plan" },
  { id: "expenses", label: "Planned Expenses", panel: "plan" },
  { id: "bills", label: "Transaction-based Bills", panel: "bills" },
  { id: "transactions", label: "Transactions", panel: "transactions" },
  { id: "transfers", label: "Transfers", panel: "transfers" },
] as const;
export type BudgetTab = (typeof budgetTabs)[number]["id"];
export default function BudgetTabs({
  selected,
  onSelect,
}: {
  selected: BudgetTab;
  onSelect: (tab: BudgetTab) => void;
}) {
  return (
    <div className="budget-tabs" role="tablist" aria-label="Budget sections">
      {budgetTabs.map((tab, index) => (
        <button
          type="button"
          role="tab"
          key={tab.id}
          id={`budget-tab-${tab.id}`}
          aria-selected={selected === tab.id}
          aria-controls={`budget-panel-${tab.panel}`}
          tabIndex={selected === tab.id ? 0 : -1}
          onClick={() => onSelect(tab.id)}
          onKeyDown={(event) => {
            let next: number;
            if (event.key === "ArrowRight")
              next = (index + 1) % budgetTabs.length;
            else if (event.key === "ArrowLeft")
              next = (index + budgetTabs.length - 1) % budgetTabs.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = budgetTabs.length - 1;
            else return;
            event.preventDefault();
            onSelect(budgetTabs[next].id);
            event.currentTarget.parentElement
              ?.querySelector<HTMLButtonElement>(
                `#budget-tab-${budgetTabs[next].id}`,
              )
              ?.focus();
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
