import { expect, it } from "vitest";
import { flowNetwork } from "../web/flowNetwork";
it("collapses account stages into one node, preserves both directions, and omits inferred balancing links", () => {
  const data = {
    nodes: [
      { id: "before:a", name: "A" },
      { id: "after:a", name: "A" },
      { id: "before:b", name: "B" },
      { id: "after:b", name: "B" },
      { id: "funding", name: "Funding" },
    ],
    links: [
      {
        source: "before:a",
        target: "after:b",
        amount: 10,
        kind: "Internal transfer",
      },
      {
        source: "before:b",
        target: "after:a",
        amount: 5,
        kind: "Internal transfer",
      },
      {
        source: "before:a",
        target: "after:a",
        amount: 20,
        kind: "Same account",
      },
      {
        source: "funding",
        target: "before:a",
        amount: 30,
        kind: "Untraced funding",
      },
    ],
  };
  const graph = flowNetwork(data);
  expect(graph.nodes.map((n) => n.id)).toEqual(["account:a", "account:b"]);
  expect(graph.links).toHaveLength(2);
  const hidden = flowNetwork(data, ["account:a"]);
  expect(hidden.links).toHaveLength(0);
  expect(hidden.accounts).toHaveLength(2);
  expect(data.links).toHaveLength(4);
});
