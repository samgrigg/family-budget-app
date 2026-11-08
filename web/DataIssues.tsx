export default function DataIssues({ issues = [] }: { issues?: any[] }) {
  if (!issues.length) return null;
  return (
    <aside className="notice" aria-label="Unresolved history overlaps">
      <strong>Estimates are incomplete: account history needs review.</strong>
      <p>
        {issues.reduce((n, i) => n + i.count, 0)} source records are withheld
        from estimates because their overlap is uncertain. They remain in
        account history.
      </p>
      <ul>
        {issues.map((i, n) => (
          <li key={n}>
            {i.date} · {i.currency} {i.amount} per record · {i.count} records.{" "}
            {i.reason}{" "}
            <a href={`#accounts/${encodeURIComponent(i.accountId)}`}>
              Review account history
            </a>
          </li>
        ))}
      </ul>
      <p>
        <a href="#accounts">Review linked accounts or unlink sources</a>
      </p>
    </aside>
  );
}
