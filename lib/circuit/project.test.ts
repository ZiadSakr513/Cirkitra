import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultBlinkProject } from "./default-project.ts";
import { connectFloatingMotorDriverEnables, normalizeGroundReturns, removeComponentFromProject, removeComponentsFromProject } from "./project.ts";
import { COMPONENT_EXAMPLES } from "./component-examples.ts";

test("removes an Arduino Uno and all wires attached to it", () => {
  const project = createDefaultBlinkProject();
  const next = removeComponentFromProject(project, "uno");

  assert.equal(next.components.some((component) => component.id === "uno"), false);
  assert.equal(
    next.connections.some(
      (connection) =>
        connection.from.componentId === "uno" ||
        connection.to.componentId === "uno",
    ),
    false,
  );
  assert.equal(project.components.some((component) => component.id === "uno"), true);
  assert.equal(next.board, "arduino-uno");
});

test("returns the same project when the component does not exist", () => {
  const project = createDefaultBlinkProject();
  assert.equal(removeComponentFromProject(project, "missing"), project);
});

test("removes a marquee selection and every attached wire in one operation", () => {
  const project = createDefaultBlinkProject();
  const next = removeComponentsFromProject(project, ["led1", "r1"]);

  assert.deepEqual(next.components.map((component) => component.id), ["uno"]);
  assert.equal(next.connections.length, 0);
  assert.equal(project.components.length, 3);
});

test("spreads ground returns across Uno pins and uses one ground symbol per overflow", () => {
  const project = createDefaultBlinkProject();
  project.components = [
    project.components.find((component) => component.id === "uno")!,
    ...Array.from({ length: 5 }, (_, index) => ({
      id: `load${index + 1}`,
      type: "led",
      label: `LED ${index + 1}`,
      x: 400 + index * 100,
      y: 100,
      rotation: 0 as const,
      properties: { color: "#ef4444" },
    })),
  ];
  project.connections = Array.from({ length: 5 }, (_, index) => ({
    id: `return-${index + 1}`,
    from: { componentId: `load${index + 1}`, pin: "K" },
    to: { componentId: "uno", pin: "GND" },
  }));

  const normalized = normalizeGroundReturns(project);
  assert.deepEqual(
    normalized.connections.slice(0, 3).map((connection) => connection.to.pin),
    ["GND", "GND2", "GND3"],
  );
  const overflow = normalized.connections.slice(3);
  assert.equal(new Set(overflow.map((connection) => connection.to.componentId)).size, 2);
  assert.ok(overflow.every((connection) => connection.to.pin === "GND"));
  assert.equal(normalized.components.filter((component) => component.type === "ground").length, 2);
  assert.deepEqual(normalizeGroundReturns(normalized), normalized, "normalization must be idempotent");
});

test("preserves a manually placed ground component", () => {
  const project = createDefaultBlinkProject();
  project.components.push({ id: "manual-ground", type: "ground", label: "GND", x: 500, y: 300 });
  project.connections[2] = {
    ...project.connections[2],
    to: { componentId: "manual-ground", pin: "GND" },
  };
  assert.equal(normalizeGroundReturns(project), project);
});

test("ties an active TB6612 standby pin to its existing logic supply", () => {
  const project = COMPONENT_EXAMPLES.tb6612fng();
  project.connections = project.connections.filter((connection) =>
    ![connection.from, connection.to].some((endpoint) => endpoint.componentId === "device" && endpoint.pin === "STBY"));

  const repaired = connectFloatingMotorDriverEnables(project);
  const vccWire = repaired.connections.find((connection) =>
    [connection.from, connection.to].some((endpoint) => endpoint.componentId === "device" && endpoint.pin === "VCC"));
  const standbyWire = repaired.connections.find((connection) =>
    [connection.from, connection.to].some((endpoint) => endpoint.componentId === "device" && endpoint.pin === "STBY"));
  assert.ok(vccWire);
  assert.ok(standbyWire);
  const vccPeer = vccWire.from.componentId === "device" && vccWire.from.pin === "VCC" ? vccWire.to : vccWire.from;
  const standbyPeer = standbyWire.from.componentId === "device" && standbyWire.from.pin === "STBY" ? standbyWire.to : standbyWire.from;
  assert.deepEqual(standbyPeer, vccPeer);
  assert.equal(connectFloatingMotorDriverEnables(repaired), repaired, "repair should be idempotent");
});

test("repairs a TB6612 standby wire connected to an unused Arduino pin", () => {
  const project = COMPONENT_EXAMPLES.tb6612fng();
  const standbyWire = project.connections.find((connection) =>
    [connection.from, connection.to].some((endpoint) => endpoint.componentId === "device" && endpoint.pin === "STBY"));
  assert.ok(standbyWire);
  if (standbyWire.from.componentId === "device" && standbyWire.from.pin === "STBY") standbyWire.to = { componentId: "uno", pin: "D7" };
  else standbyWire.from = { componentId: "uno", pin: "D7" };

  const repaired = connectFloatingMotorDriverEnables(project);
  const vccWire = repaired.connections.find((connection) =>
    [connection.from, connection.to].some((endpoint) => endpoint.componentId === "device" && endpoint.pin === "VCC"));
  const fixedStandbyWire = repaired.connections.find((connection) =>
    [connection.from, connection.to].some((endpoint) => endpoint.componentId === "device" && endpoint.pin === "STBY"));
  assert.ok(vccWire);
  assert.ok(fixedStandbyWire);
  const vccPeer = vccWire.from.componentId === "device" && vccWire.from.pin === "VCC" ? vccWire.to : vccWire.from;
  const standbyPeer = fixedStandbyWire.from.componentId === "device" && fixedStandbyWire.from.pin === "STBY" ? fixedStandbyWire.to : fixedStandbyWire.from;
  assert.deepEqual(standbyPeer, vccPeer);
});

test("preserves TB6612 standby wiring when its Arduino pin is used by the sketch", () => {
  const project = COMPONENT_EXAMPLES.tb6612fng();
  const standbyWire = project.connections.find((connection) =>
    [connection.from, connection.to].some((endpoint) => endpoint.componentId === "device" && endpoint.pin === "STBY"));
  assert.ok(standbyWire);
  if (standbyWire.from.componentId === "device" && standbyWire.from.pin === "STBY") standbyWire.to = { componentId: "uno", pin: "D7" };
  else standbyWire.from = { componentId: "uno", pin: "D7" };
  project.code += " void setup(){ pinMode(7, OUTPUT); digitalWrite(7, HIGH); }";

  assert.equal(connectFloatingMotorDriverEnables(project), project);
});
