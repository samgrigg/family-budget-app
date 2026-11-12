export function accountGroups(accounts: any[]) {
  const groups = [
    {
      id: "cash",
      name: "Cash & savings",
      description: "Current balances in checking and savings accounts.",
      types: ["depository"],
    },
    {
      id: "cards",
      name: "Credit cards",
      description: "Amounts owed on your credit cards.",
      types: ["credit"],
    },
    {
      id: "loans",
      name: "Loans",
      description: "Remaining amounts owed on loans.",
      types: ["loan"],
    },
    {
      id: "other",
      name: "Other accounts",
      description: "Balances reported for other account types.",
      types: [],
    },
  ];
  return groups
    .map((g) => ({
      ...g,
      accounts: accounts.filter((a) =>
        g.id === "other"
          ? !["depository", "credit", "loan"].includes(a.type)
          : g.types.includes(a.type),
      ),
    }))
    .filter((g) => g.accounts.length);
}
