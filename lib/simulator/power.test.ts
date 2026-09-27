import test from "node:test";
import assert from "node:assert/strict";
import { PowerRuntime } from "./power.ts";
import { createDefaultBlinkProject } from "../circuit/default-project.ts";
import type { CircuitProject } from "../circuit/types.ts";

function circuit() {
  const project: CircuitProject = { ...createDefaultBlinkProject(), components: [], connections: [] };
  const add = (id: string, type: string, properties = {}) => project.components.push({ id, type, label: id, x: 0, y: 0, properties });
  const wire = (id: string, pin: string, other: string, to: string) => project.connections.push({ id: `w${project.connections.length}`, from: { componentId: id, pin }, to: { componentId: other, pin: to } });
  add("gnd", "ground");
  return { project, add, wire, runtime: new PowerRuntime() };
}
const close = (actual: number, expected: number, tolerance = 1e-7) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);

test("DC voltages and sense-resistor current follow a real return path", () => {
  const { project, add, wire, runtime } = circuit();
  add("source", "dc-supply", { voltage: 12 }); add("load", "dc-load", { resistance: 11.99 }); add("sense", "resistor", { resistance: 0.01 });
  wire("source", "+", "load", "+"); wire("load", "-", "sense", "1"); wire("sense", "2", "source", "-"); wire("source", "-", "gnd", "GND");
  const result = runtime.solve(project, 0);
  close(result.current("load"), 1); close(result.current("source"), 1);
  close(result.voltage("sense", "1")!, 0.01);
  project.connections = project.connections.filter(w => w.from.componentId !== "sense");
  const open = runtime.solve(project, 1000); close(open.current("load"), 0);
});

test("battery charge changes with current and simulated time, reset restores initial charge", () => {
  const { project, add, wire, runtime } = circuit();
  add("cell", "battery-cell", { initialSoc: 50, capacityMah: 1000 }); add("load", "dc-load", { resistance: 3.6 });
  wire("cell", "+", "load", "+"); wire("cell", "-", "load", "-"); wire("cell", "-", "gnd", "GND");
  let result = runtime.solve(project, 0); close(result.current("cell"), 1);
  result = runtime.solve(project, 360000); close(result.states.cell.readings!.soc, 40);
  result = runtime.solve(project, 360000); close(result.states.cell.readings!.soc, 40);
  runtime.reset(); result = runtime.solve(project, 0); close(result.states.cell.readings!.soc, 50);
  project.components.find(c => c.id === "load")!.properties = { enabled: false };
  runtime.solve(project, 0, {}, { cell: 0.5 });
  result = runtime.solve(project, 360000, {}, { cell: 0.5 }); close(result.states.cell.readings!.soc, 55);
});

test("protection switch disconnects the load and source conflicts produce diagnostics", () => {
  const { project, add, wire, runtime } = circuit();
  add("cell", "battery-cell"); add("load", "dc-load", { resistance: 10 }); add("switch", "ideal-mosfet");
  wire("cell", "+", "load", "+"); wire("load", "-", "switch", "D"); wire("switch", "S", "cell", "-"); wire("cell", "-", "gnd", "GND");
  close(runtime.solve(project, 0).current("load"), 0);
  close(runtime.solve(project, 0, { switch: 1 }).current("load"), 3.6 / 10.001);
  add("source", "dc-supply", { voltage: 5 }); wire("source", "+", "cell", "+"); wire("source", "-", "cell", "-");
  const conflict = runtime.solve(project, 0, { switch: 1 });
  assert.ok(conflict.diagnostics.some(d => d.code === "DC_POWER_CONFLICT"));
  assert.equal(conflict.states.cell.powered, false);
});
