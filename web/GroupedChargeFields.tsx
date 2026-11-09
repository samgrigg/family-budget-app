import { useEffect, useRef, useState } from "react";
export type ChargeRow = { id: number; key: string; label: string };
export default function GroupedChargeFields({
  rows,
  setRows,
  choices,
  enabled,
}: {
  rows: ChargeRow[];
  setRows: React.Dispatch<React.SetStateAction<ChargeRow[]>>;
  choices: any[];
  enabled: boolean;
}) {
  const sequence = useRef(Math.max(0, ...rows.map((r) => r.id)));
  const [focusId, setFocusId] = useState<number | null>(null);
  const selects = useRef(new Map<number, HTMLSelectElement>());
  const addButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (focusId !== null) {
      (selects.current.get(focusId) ?? addButton.current)?.focus();
      setFocusId(null);
    }
  }, [focusId, rows]);
  return (
    <fieldset className="grouped-charges" hidden={!enabled} disabled={!enabled}>
      <legend>Separate posted charges</legend>
      <input type="hidden" name="groupedCharges" value="on" />
      <p>
        Link each transaction once. Labels can identify family members. Similar
        amounts are separate charges, not duplicate commitments.
      </p>
      {rows.map((row, index) => (
        <fieldset key={row.id} className="charge-row">
          <legend>Charge {index + 1}</legend>
          <label>
            Charge label (optional)
            <input
              name="chargeLabel"
              maxLength={120}
              value={row.label}
              onChange={(e) =>
                setRows((all) =>
                  all.map((r) =>
                    r.id === row.id ? { ...r, label: e.target.value } : r,
                  ),
                )
              }
            />
          </label>
          <label>
            Posted transaction for charge {index + 1}
            <select
              name="chargeKey"
              ref={(el) => {
                if (el) selects.current.set(row.id, el);
                else selects.current.delete(row.id);
              }}
              value={row.key}
              onChange={(e) =>
                setRows((all) =>
                  all.map((r) =>
                    r.id === row.id ? { ...r, key: e.target.value } : r,
                  ),
                )
              }
            >
              <option value="">Not linked yet</option>
              {row.key && !choices.some((c) => c.key === row.key) && (
                <option value={row.key}>
                  Previously linked charge · evidence unavailable
                </option>
              )}
              {choices.map((t) => (
                <option
                  key={t.key}
                  value={t.key}
                  disabled={rows.some(
                    (r) => r.id !== row.id && r.key === t.key,
                  )}
                >
                  {t.date} · {t.accountName} · {t.name} · {t.currency}{" "}
                  {t.amount}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="secondary"
            aria-label={`Remove charge ${index + 1}`}
            onClick={() => {
              const remaining = rows.filter((r) => r.id !== row.id);
              setRows(remaining);
              setFocusId(
                remaining[Math.min(index, remaining.length - 1)]?.id ?? -1,
              );
            }}
          >
            Remove charge
          </button>
        </fieldset>
      ))}
      <button
        ref={addButton}
        type="button"
        className="secondary"
        disabled={rows.length >= 24}
        onClick={() => {
          const id = ++sequence.current;
          setRows((all) => [...all, { id, key: "", label: "" }]);
          setFocusId(id);
        }}
      >
        Add another charge
      </button>
      <p>
        Only posted outflows in the selected month and currency are listed, from
        the latest 2,000 stored outflows. An unlinked charge does not cancel a
        membership.
      </p>
    </fieldset>
  );
}
