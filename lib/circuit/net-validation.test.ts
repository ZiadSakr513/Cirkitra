import assert from "node:assert/strict";
import test from "node:test";

import { COMPONENT_CATALOG } from "./catalog.ts";
import { validateNetEndpointCompatibility, validateProjectNetEndpointCompatibility } from "./net-validation.ts";

const availableParts = Object.values(COMPONENT_CATALOG);
const components = [
  { id: "uno", type: "arduino-uno", label: "Uno" },
  { id: "mega", type: "arduino-mega-2560", label: "Mega" },
  { id: "status-led", type: "led", label: "Status LED" },
];

test("net validation permits shared board grounds and a cross-board signal net", () => {
  const issues = validateNetEndpointCompatibility(components, [
    { id: "shared-ground", endpoints: [
      { componentId: "uno", pin: "GND" },
      { componentId: "mega", pin: "GND" },
    ] },
    { id: "uart-signal", endpoints: [
      { componentId: "uno", pin: "D1" },
      { componentId: "mega", pin: "D0" },
    ] },
  ], availableParts);

  assert.deepEqual(issues, []);
});

test("net validation rejects a board GPIO tied to ground or a positive rail", () => {
  const issues = validateNetEndpointCompatibility(components, [
    { id: "gpio-ground", endpoints: [
      { componentId: "uno", pin: "D7" },
      { componentId: "uno", pin: "GND" },
    ] },
    { id: "gpio-rail", endpoints: [
      { componentId: "uno", pin: "D8" },
      { componentId: "uno", pin: "5V" },
    ] },
  ], availableParts);

  assert.equal(issues.filter(issue => issue.code === "NET_PIN_CONTENTION").length, 2);
});

test("net validation rejects distinct GPIOs on the same board and opposing LED terminals on one net", () => {
  const issues = validateNetEndpointCompatibility(components, [
    { id: "two-gpios", endpoints: [
      { componentId: "uno", pin: "D4" },
      { componentId: "uno", pin: "D5" },
    ] },
    { id: "shorted-led", endpoints: [
      { componentId: "status-led", pin: "A" },
      { componentId: "status-led", pin: "K" },
    ] },
  ], availableParts);

  assert.ok(issues.some(issue => issue.code === "NET_PIN_CONTENTION" && issue.netIds.includes("two-gpios")));
  assert.ok(issues.some(issue => issue.code === "NET_COMPONENT_SHORT" && issue.netIds.includes("shorted-led")));
});

test("project validation traces a direct LED anode-cathode short through wire endpoints", () => {
  const issues = validateProjectNetEndpointCompatibility(components, [
    { id: "wire-anode", from: { componentId: "uno", pin: "D7" }, to: { componentId: "status-led", pin: "A" } },
    { id: "wire-cathode", from: { componentId: "uno", pin: "D7" }, to: { componentId: "status-led", pin: "K" } },
  ], availableParts);

  assert.ok(issues.some(issue => issue.code === "NET_COMPONENT_SHORT"));
});
