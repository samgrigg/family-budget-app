function amount(value: string, currency: string) {
  if (/^[A-Z]{3}$/.test(currency)) {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
      }).format(Number(value));
    } catch {
      /* Unofficial currencies keep their supplied code. */
    }
  }
  return `${currency || "Currency unknown"} ${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
export default function AccountBalance({ account }: { account: any }) {
  const b = account.balance;
  const debt = account.type === "credit" || account.type === "loan";
  const availableLabel =
    account.type === "credit"
      ? "Available credit"
      : account.type === "depository"
        ? "Available funds"
        : account.type === "investment"
          ? "Withdrawable cash"
          : null;
  return (
    <div className="account-balance">
      <span className="balance-label">
        {debt ? "Amount owed" : "Current balance"}
      </span>
      <strong className="balance-value">
        {b?.current != null
          ? amount(b.current, b.currency)
          : "Balance unavailable"}
      </strong>
      {availableLabel && b?.available != null && (
        <span>
          {availableLabel}: {amount(b.available, b.currency)}
        </span>
      )}
      {b?.stale && (
        <span className="balance-stale">Stale · last saved balance</span>
      )}
      {b?.retrievedAt && (
        <span>
          Retrieved{" "}
          <time dateTime={b.retrievedAt}>
            {new Date(b.retrievedAt).toLocaleString()}
          </time>
        </span>
      )}
      {!b && <span>Sync in Admin to retrieve a balance.</span>}
    </div>
  );
}
