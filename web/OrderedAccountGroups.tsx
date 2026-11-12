import { useRef, useState } from "react";
import { accountGroups } from "./accountGroups";
import AccountBalance from "./AccountBalance";
import {
  loadAccountOrder,
  saveAccountOrder,
  orderedAccounts,
  moveAccount,
  type AccountOrder,
} from "./accountOrder";
export default function OrderedAccountGroups({ index }: { index: any }) {
  const [saved, setSaved] = useState<AccountOrder>(() => {
    try {
      return loadAccountOrder(localStorage, index.environment);
    } catch {
      return {};
    }
  });
  const [draft, setDraft] = useState<AccountOrder>({});
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const drag = useRef<{ group: string; id: string } | null>(null);
  const [drop, setDrop] = useState<{
    id: string;
    edge: "before" | "after";
  } | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const redirects = (index.account_redirects || []).filter(
    (r: any) => r.env === index.environment,
  );
  const groups = accountGroups(index.accounts).map((group) => ({
    ...group,
    accounts: orderedAccounts(
      group.accounts,
      (editing ? draft : saved)[group.id as keyof AccountOrder],
      redirects,
    ),
  }));
  const snapshot = (): AccountOrder =>
    Object.fromEntries(groups.map((g) => [g.id, g.accounts.map((a) => a.id)]));
  function move(
    group: (typeof groups)[number],
    source: string,
    target: string,
    edge: "before" | "after",
  ) {
    if (!editing) return;
    const ids = group.accounts.map((a) => a.id);
    const next = moveAccount(ids, source, target, edge);
    if (next === ids || next.every((id, n) => id === ids[n])) return;
    setDraft((d) => ({ ...d, [group.id]: next }));
    const name = group.accounts.find((a) => a.id === source)?.name || "Account";
    setNotice(
      `${name} moved to position ${next.indexOf(source) + 1} of ${next.length} in ${group.name}.`,
    );
  }
  function dropTarget(
    x: number,
    y: number,
  ): { id: string; edge: "before" | "after" } | null {
    const row = document
      .elementFromPoint(x, y)
      ?.closest<HTMLElement>("li[data-order-group]");
    if (
      !row ||
      row.dataset.orderGroup !== drag.current?.group ||
      row.dataset.orderId === drag.current?.id
    )
      return null;
    const bounds = row.getBoundingClientRect();
    return {
      id: row.dataset.orderId!,
      edge: y > bounds.top + bounds.height / 2 ? "after" : "before",
    };
  }
  function finish() {
    setEditing(false);
    setDrop(null);
    drag.current = null;
    requestAnimationFrame(() => editButton.current?.focus());
  }
  return (
    <>
      {(editing || index.accounts.length > 1) && (
        <div className="account-order-toolbar">
          {!editing ? (
            <button
              ref={editButton}
              className="secondary"
              onClick={() => {
                setDraft(snapshot());
                setEditing(true);
                setNotice("");
                setError("");
              }}
            >
              Edit order
            </button>
          ) : (
            <>
              <button
                onClick={() => {
                  try {
                    const next = snapshot();
                    saveAccountOrder(localStorage, index.environment, next);
                    setSaved(next);
                    setError("");
                    setNotice("Account order saved in this browser.");
                    finish();
                  } catch {
                    setError(
                      "Could not save your order in this browser. Allow browser storage, then try Save order again. Your changes are still here.",
                    );
                  }
                }}
              >
                Save order
              </button>
              <button
                className="secondary"
                onClick={() => {
                  setError("");
                  setNotice("Order changes canceled.");
                  finish();
                }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      )}
      {editing && (
        <p id="account-order-help">
          Drag the handle or use Move up and Move down. Accounts stay within
          their current section. Choose Save order when finished.
        </p>
      )}
      <p className="account-order-status" role="status">
        {notice}
      </p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {groups.map((group) => (
        <section
          className={editing ? "account-group is-reordering" : "account-group"}
          key={group.id}
          aria-labelledby={`group-${group.id}`}
        >
          <div className="account-group-heading">
            <h2 id={`group-${group.id}`}>{group.name}</h2>
            <span>
              {group.accounts.length}{" "}
              {group.accounts.length === 1 ? "account" : "accounts"}
            </span>
          </div>
          {!editing && <p>{group.description}</p>}
          <ul className="accounts-balance-list">
            {group.accounts.map((a: any, position: number) => (
              <li
                key={a.id}
                className={
                  drop && drop.id === a.id
                    ? `order-drop-${drop.edge}`
                    : undefined
                }
                data-order-group={group.id}
                data-order-id={a.id}
              >
                <div className="account-identity">
                  {editing ? (
                    <strong
                      className="account-order-name"
                      title={`${a.name}${a.mask ? ` · ••${a.mask}` : ""}`}
                    >
                      <span>{a.name}</span>
                      {a.mask && <span>••{a.mask}</span>}
                    </strong>
                  ) : (
                    <a
                      className="account-history-link"
                      href={`#accounts/${encodeURIComponent(a.id)}`}
                    >
                      <strong>
                        {a.name}
                        {a.mask ? ` · ••${a.mask}` : ""}
                      </strong>
                      <span>View transactions →</span>
                    </a>
                  )}
                  {!editing && (
                    <>
                      <span>
                        {index.institutions.find(
                          (i: any) => i.id === a.institutionId,
                        )?.name || "Institution not identified"}{" "}
                        · {a.subtype || a.type || "Type unknown"}
                      </span>
                      {a.stale && (
                        <span>
                          Connection needs attention ·{" "}
                          <a href="#admin">Manage connection</a>
                        </span>
                      )}
                    </>
                  )}
                </div>
                {!editing && <AccountBalance account={a} compact />}
                {editing && (
                  <div
                    className="account-order-controls"
                    aria-label={`Order ${a.name}`}
                  >
                    <span
                      className="account-drag-handle"
                      aria-hidden="true"
                      title={`Drag ${a.name} to reorder`}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.preventDefault();
                        drag.current = { group: group.id, id: a.id };
                        e.currentTarget.setPointerCapture(e.pointerId);
                      }}
                      onPointerMove={(e) => {
                        if (!drag.current) return;
                        setDrop(dropTarget(e.clientX, e.clientY));
                      }}
                      onPointerUp={(e) => {
                        const target = dropTarget(e.clientX, e.clientY);
                        if (drag.current && target)
                          move(group, drag.current.id, target.id, target.edge);
                        drag.current = null;
                        setDrop(null);
                        if (e.currentTarget.hasPointerCapture(e.pointerId))
                          e.currentTarget.releasePointerCapture(e.pointerId);
                      }}
                      onPointerCancel={() => {
                        drag.current = null;
                        setDrop(null);
                      }}
                      onLostPointerCapture={() => {
                        drag.current = null;
                        setDrop(null);
                      }}
                    >
                      ⠿
                    </span>
                    <span className="account-order-position">
                      Position {position + 1} of {group.accounts.length}
                    </span>
                    <button
                      type="button"
                      className="secondary order-move-up"
                      title="Move up"
                      aria-label={`Move ${a.name} up in ${group.name}`}
                      aria-disabled={position === 0}
                      onClick={() => {
                        if (position > 0)
                          move(
                            group,
                            a.id,
                            group.accounts[position - 1].id,
                            "before",
                          );
                      }}
                    >
                      <span aria-hidden="true">↑</span>
                    </button>
                    <button
                      type="button"
                      className="secondary order-move-down"
                      title="Move down"
                      aria-label={`Move ${a.name} down in ${group.name}`}
                      aria-disabled={position === group.accounts.length - 1}
                      onClick={() => {
                        if (position < group.accounts.length - 1)
                          move(
                            group,
                            a.id,
                            group.accounts[position + 1].id,
                            "after",
                          );
                      }}
                    >
                      <span aria-hidden="true">↓</span>
                    </button>
                    {drop && drop.id === a.id && (
                      <span className="order-drop-label">
                        Drop {drop.edge} {a.name}
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
