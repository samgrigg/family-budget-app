import React, { useState } from "react";
import type { FundingSource } from "../shared/paycheckReview";
export default function IncomeSourceSetup({
  sources,
  accounts,
  busy,
  onSave,
}: {
  sources: FundingSource[];
  accounts: {
    id: string;
    name: string;
    type: string | null;
    included: boolean;
  }[];
  busy: boolean;
  onSave: (source: FundingSource) => Promise<string>;
}) {
  const [selected, setSelected] = useState(""),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState(sources.length === 0);
  const source = sources.find((s) => s.id === selected);
  return (
    <details
      open={expanded}
      onToggle={(e) => setExpanded(e.currentTarget.open)}
    >
      <summary>Set up an income source</summary>
      {sources.length > 0 && (
        <ul aria-label="Saved income sources">
          {sources.map((s) => (
            <li key={s.id}>
              {s.name} →{" "}
              {accounts.find((a) => a.id === s.accountId)?.name ??
                "Account needs review"}
            </li>
          ))}
        </ul>
      )}
      <p>
        Assign an employer to an existing account. This does not connect a bank
        or import transactions.
      </p>
      <p role="status">{message}</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <form
        key={selected}
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const record = {
            id: source?.id ?? `tmp:${crypto.randomUUID()}`,
            name: String(f.get("name") ?? "").trim(),
            accountId: String(f.get("account") ?? ""),
            incomeKey: source?.incomeKey ?? null,
          };
          setSaving(true);
          setError("");
          setMessage("");
          try {
            const savedId = await onSave(record);
            setSelected(savedId);
            setExpanded(true);
            setMessage(
              `${record.name} saved. Select its deposit under “Add an arrived or expected paycheck” next.`,
            );
          } catch (e: any) {
            setError(
              e.message ?? "Income source could not be saved. Try again.",
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        <label>
          Income source to add or correct
          <select
            value={selected}
            onChange={(e) => {
              setSelected(e.target.value);
              setMessage("");
              setError("");
            }}
            disabled={saving || busy}
          >
            <option value="">New income source</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Employer
          <input
            name="name"
            placeholder="Canyons or Adobe"
            required
            maxLength={150}
            defaultValue={source?.name ?? ""}
            disabled={saving || busy}
          />
        </label>
        <label>
          Paycheck account
          <select
            name="account"
            required
            defaultValue={source?.accountId ?? ""}
            disabled={saving || busy}
          >
            <option value="">Choose account</option>
            {accounts
              .filter((a) => a.type !== "credit")
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.included ? "" : " · hidden from budgets"}
                </option>
              ))}
          </select>
        </label>
        <button type="submit" disabled={saving || busy}>
          {saving
            ? "Saving income source…"
            : source
              ? "Save income source"
              : "Add income source"}
        </button>
      </form>
    </details>
  );
}
