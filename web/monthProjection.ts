// An abstract month has 31 positions; short months use their final day instead.
export function buildOverview(bills: any[]) {
  const events: any[] = [],
    occasional: any[] = [],
    unscheduled: any[] = [];
  const totals = new Map<string, number>();
  for (const bill of bills) {
    const dates = bill.transactions
      .map((t: any) => new Date(`${t.date}T00:00:00Z`))
      .filter((d: Date) => Number.isFinite(d.getTime()));
    if (!dates.length || bill.typical === null) {
      unscheduled.push(bill);
      continue;
    }
    let days: number[];
    let factor: number;
    let approximate = false;
    const monthEnd =
      dates.filter(
        (d: Date) =>
          new Date(
            Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
          ).getUTCDate() -
            d.getUTCDate() <=
          2,
      ).length >
      dates.length / 2;
    if (bill.frequency === "Monthly") {
      const sorted = dates
        .map((d: Date) => d.getUTCDate())
        .sort((a: number, b: number) => a - b);
      days = [monthEnd ? 31 : sorted[Math.floor(sorted.length / 2)]];
      factor = 1;
    } else if (["Weekly", "Every two weeks"].includes(bill.frequency)) {
      const interval = bill.frequency === "Weekly" ? 7 : 14;
      const latest = dates.reduce((a: Date, b: Date) => (a > b ? a : b));
      const first = ((latest.getUTCDate() - 1) % interval) + 1;
      days = [];
      for (let day = first; day <= 31; day += interval) days.push(day);
      factor = bill.frequency === "Weekly" ? 52 / 12 : 26 / 12;
      approximate = true;
    } else {
      (bill.frequency === "Irregular" ? unscheduled : occasional).push(bill);
      continue;
    }
    for (const day of days)
      events.push({
        bill,
        day,
        monthEnd: bill.frequency === "Monthly" && monthEnd,
        approximate,
      });
    if (bill.currency && bill.expenseType !== "creditPayment")
      totals.set(
        bill.currency,
        (totals.get(bill.currency) ?? 0) + Number(bill.typical) * factor,
      );
  }
  events.sort(
    (a, b) => a.day - b.day || a.bill.name.localeCompare(b.bill.name),
  );
  return {
    events,
    occasional,
    unscheduled,
    totals: [...totals].map(([currency, amount]) => ({ currency, amount })),
  };
}
