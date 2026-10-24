import assert from "node:assert/strict";
import test from "node:test";

import type { CoordinatedWireInput, CoordinatedWireRoute } from "./geometry.ts";
import { isCompleteWireRouteSet, wireRouteCacheKey } from "./route-cache.ts";

const wires: CoordinatedWireInput[] = [{
  id: "wire-a",
  from: { point: { x: 20, y: 30 }, side: "right" },
  to: { point: { x: 120, y: 80 }, side: "left" },
}];
const routes: CoordinatedWireRoute[] = [{
  id: "wire-a",
  segments: [
    { from: { x: 20, y: 30 }, to: { x: 50, y: 30 } },
    { from: { x: 50, y: 30 }, to: { x: 50, y: 80 } },
    { from: { x: 50, y: 80 }, to: { x: 120, y: 80 } },
  ],
  bridges: [],
}];

test("wire route cache keys include exact endpoints and component geometry", () => {
  const input = { wires, components: [{ id: "board", type: "uno", x: 0, y: 0 }] };
  assert.equal(wireRouteCacheKey(input), wireRouteCacheKey(structuredClone(input)));
  assert.notEqual(wireRouteCacheKey(input), wireRouteCacheKey({
    ...input,
    components: [{ ...input.components[0], x: 1 }],
  }));
  assert.notEqual(wireRouteCacheKey(input), wireRouteCacheKey({
    ...input,
    wires: [{ ...wires[0], to: { ...wires[0].to, point: { x: 121, y: 80 } } }],
  }));
});

test("cached routes are accepted only when every wire has a finite orthogonal route attached to its pins", () => {
  assert.equal(isCompleteWireRouteSet(routes, wires), true);
  assert.equal(isCompleteWireRouteSet([], wires), false);
  assert.equal(isCompleteWireRouteSet([{ ...routes[0], segments: routes[0].segments.slice(1) }], wires), false);
  assert.equal(isCompleteWireRouteSet([{ ...routes[0], segments: [{ from: { x: 20, y: 30 }, to: { x: 21, y: 31 } }] }], wires), false);
  assert.equal(isCompleteWireRouteSet([{ ...routes[0], id: "wrong-id" }], wires), false);
});
