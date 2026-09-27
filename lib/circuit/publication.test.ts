import test from "node:test";
import assert from "node:assert/strict";
import { normalizeGroundReturns } from "./project.ts";
import { COMPONENT_CATALOG, getComponentDefinition } from "./catalog.ts";
import { COMPONENT_ACCEPTANCE, publicationIssues } from "./publication.ts";
import { COMPONENT_EXAMPLES } from "./component-examples.ts";
import { EXPANDED_COMPONENTS } from "./parts.ts";
import { exportCircuitProject, importCircuitProject } from "./import.ts";
import { ArduinoSimulator, solveCircuit } from "../simulator/index.ts";

for (const [id, make] of Object.entries(COMPONENT_EXAMPLES)) test(`${id} publication example executes its acceptance fixture and survives export`, () => {
  const project = normalizeGroundReturns(make());
  assert.deepEqual(publicationIssues(getComponentDefinition(id)!), []);
  const restored = importCircuitProject(exportCircuitProject(project));
  assert.equal(restored.ok, true);
  if (!restored.ok) return;
  assert.deepEqual(restored.project, project);
  const simulator = new ArduinoSimulator(project.code); simulator.attachProject(project);
  assert.equal(simulator.getSnapshot().diagnostics.some(d => d.severity === "error"), false, JSON.stringify(simulator.getSnapshot().diagnostics));
  simulator.run(); simulator.advance(0);
  const initial = solveCircuit(project, simulator.getSnapshot());
  assert.deepEqual(initial.diagnostics.filter(d => d.severity === "error"), []);
  const fixture = COMPONENT_ACCEPTANCE[id];
  if (fixture === "mux-switches-reading") {
    assert.equal(simulator.getSnapshot().serial[0]?.text, "0");
    simulator.advance(500); assert.equal(simulator.getSnapshot().serial[1]?.text, "1023");
  } else if (fixture === "decoder-switches-led") {
    assert.equal(initial.componentStates.led.powered, true);
    simulator.advance(500); assert.equal(solveCircuit(project, simulator.getSnapshot()).componentStates.led.powered, false);
  } else if (fixture === "independent-opposite-motors") {
    assert.equal(initial.componentStates["motor-a"].direction, "forward");
    assert.ok(Math.abs(initial.componentStates["motor-a"].speed! - 128 / 255) < 0.001);
    assert.equal(initial.componentStates["motor-b"].direction, "reverse");
    assert.equal(initial.componentStates["motor-b"].speed, 1);
  } else if (fixture === "wired-temperature-pressure-humidity" || fixture === "wired-temperature-pressure") {
    simulator.advance(20);
    const readings = simulator.getSnapshot().componentStates.device.readings!;
    assert.equal(readings.temperature, 25); assert.equal(readings.pressure, 101325);
    if (fixture === "wired-temperature-pressure-humidity") assert.equal(readings.humidity, 50);
    const changed = { ...project, components: project.components.map(c => c.id === "device" ? { ...c, properties: { ...c.properties, temperature: 31, pressure: 99000, humidity: 66 } } : c) };
    simulator.attachProject(changed); simulator.advance(0);
    assert.equal(simulator.getSnapshot().componentStates.device.readings!.temperature, 31);
  } else if (fixture === "timed-temperature-humidity") {
    simulator.advance(20);
    const readings = simulator.getSnapshot().componentStates.device.readings!;
    assert.equal(readings.temperature, 25); assert.equal(readings.humidity, 50);
  } else if (fixture === "onewire-conversion-readback") {
    simulator.advance(1000);
    assert.ok(simulator.getSnapshot().serial.some(entry => entry.text === "25"), "blocking conversion reports the wired sensor temperature");
  } else if (fixture === "dht-timed-sampling") {
    simulator.advance(0);
    assert.ok(simulator.getSnapshot().serial.some(entry => entry.text === "25"));
    assert.ok(simulator.getSnapshot().serial.some(entry => entry.text === "50"));
    simulator.advance(1000);
    assert.equal(simulator.getSnapshot().serial.at(-2)?.text, "25", "cache remains stable inside the two second sampling interval");
  } else if (fixture === "imu-structured-live-readings") {
    simulator.advance(0);
    assert.ok(simulator.getSnapshot().serial.some(entry => entry.text === "1.25"), JSON.stringify({serial:simulator.getSnapshot().serial,diagnostics:simulator.getSnapshot().diagnostics}));
    assert.ok(simulator.getSnapshot().serial.some(entry => entry.text === "0.5"), "structured gyro result is read from the powered sensor");
    assert.ok(simulator.getSnapshot().serial.some(entry => entry.text === "25"));
  } else if (fixture === "isolated-mux-channel-reaches-device") {
    simulator.advance(20);
    assert.equal(simulator.getSnapshot().serial[0]?.text, "29");
    const isolated = { ...project, code: "#include <TCA9548.h>\\n#include <Adafruit_BMP280.h>\\nTCA9548 mux(0x70); Adafruit_BMP280 sensor; void setup(){mux.begin(); mux.closeAll(); sensor.begin(0x76);} void loop(){Serial.println(sensor.readTemperature()); delay(500);}", connections: project.connections.filter(w => !["device", "sensor"].includes(w.from.componentId)) };
    const blocked = new ArduinoSimulator(isolated.code); blocked.attachProject(isolated); blocked.run(); blocked.advance(0);
    blocked.advance(20);
    assert.notEqual(blocked.getSnapshot().serial[0]?.text, "29", "closed mux does not forward downstream measurements");
  } else if (fixture === "gpio-expander-switches-wired-led") {
    simulator.advance(0);
    assert.equal(solveCircuit(project, simulator.getSnapshot()).componentStates.led.powered, true, JSON.stringify({snapshot:simulator.getSnapshot(),solved:solveCircuit(project, simulator.getSnapshot())}));
    simulator.advance(250);
    assert.equal(solveCircuit(project, simulator.getSnapshot()).componentStates.led.powered, false);
    simulator.advance(250);
    assert.equal(solveCircuit(project, simulator.getSnapshot()).componentStates.led.powered, true);
  } else if (fixture === "shift-register-clock-and-latch-drive-led") {
    simulator.advance(0);
    assert.equal(solveCircuit(project, simulator.getSnapshot()).componentStates.led.powered, true);
    simulator.advance(500);
    assert.equal(solveCircuit(project, simulator.getSnapshot()).componentStates.led.powered, false);
    simulator.advance(500);
    assert.equal(solveCircuit(project, simulator.getSnapshot()).componentStates.led.powered, true);
  } else if (fixture === "wired-lora-peer-send-and-receive") {
    simulator.advance(20);
    const radio = simulator.getSnapshot().componentStates.device;
    assert.ok(radio.packets?.some(packet => packet.direction === "tx" && packet.status === "Delivered to virtual peer"), JSON.stringify({radio, diagnostics:simulator.getSnapshot().diagnostics, pins:simulator.getSnapshot().pins.slice(2,14)}));
    assert.equal(simulator.injectPacket("device", "reply"), true);
    assert.ok(simulator.getSnapshot().componentStates.device.packets?.some(packet => packet.direction === "rx" && packet.status === "Received"));
  } else if (fixture === "wired-zigbee-peer-send-and-receive") {
    simulator.advance(300);
    const radio = simulator.getSnapshot().componentStates.device;
    assert.ok(radio.packets?.some(packet => packet.direction === "tx" && packet.status === "Delivered to Zigbee virtual peer"));
    assert.equal(simulator.injectPacket("device", "reply"), true);
    assert.ok(simulator.getSnapshot().componentStates.device.packets?.some(packet => packet.direction === "rx" && packet.status === "Received Zigbee packet"));
  } else if (fixture === "wired-fuel-gauge-reports-discharging-cell") {
    simulator.advance(0);
    const readings = simulator.getSnapshot().componentStates.device.readings!;
    assert.ok(readings.voltage! > 3.5 && readings.voltage! < 4, "battery voltage is exposed in volts in component readings");
    assert.ok(readings.current! < -0.05, "the sense resistor reports load discharge in amperes with the correct sign");
    const initialSoc = readings.soc!;
    simulator.advance(360000);
    assert.ok(simulator.getSnapshot().componentStates.device.readings!.soc! < initialSoc);
    assert.ok(simulator.getSnapshot().serial.some(entry => entry.text === "-100" || Number(entry.text) < 0));
  } else if (fixture === "wired-supply-powers-switched-load") {
    const states = simulator.getSnapshot().componentStates;
    assert.equal(states.device.readings?.voltage, 5);
    assert.ok((states["system-load"].readings?.current ?? Number.NaN) > 0.04);
    assert.equal(states["system-load"].powered, true);
  } else if (fixture === "wired-cell-supplies-load") {
    assert.equal(simulator.getSnapshot().componentStates.device.powered, true);
    const soc = simulator.getSnapshot().componentStates.device.readings?.soc ?? Number.NaN;
    simulator.advance(360000); assert.ok(simulator.getSnapshot().componentStates.device.readings!.soc! < soc);
  } else if (fixture === "wired-load-draws-current") {
    const load = simulator.getSnapshot().componentStates.device;
    assert.ok((load.readings?.current ?? Number.NaN) > 0.01);
    assert.ok((load.readings?.voltage ?? Number.NaN) > 3);
  } else if (fixture === "wired-gate-switches-load") {
    assert.ok((simulator.getSnapshot().componentStates["system-load"].readings?.current ?? Number.NaN) > 0.04);
    simulator.advance(500); assert.ok((simulator.getSnapshot().componentStates["system-load"].readings?.current ?? Number.NaN) < 0.001);
  } else if (fixture === "wired-charger-charges-and-protects-battery") {
    assert.equal(simulator.getSnapshot().componentStates.device.status, "Charging");
    assert.ok((simulator.getSnapshot().componentStates.device.readings?.chargeCurrent ?? Number.NaN) > 0.08);
    const initialSoc = simulator.getSnapshot().componentStates.cell.readings?.soc ?? Number.NaN;
    simulator.advance(360000); assert.ok(simulator.getSnapshot().componentStates.cell.readings!.soc! > initialSoc);
    const hot = { ...project, components: project.components.map(c => c.id === "cell" ? { ...c, properties: { ...c.properties, temperature: 55 } } : c) };
    simulator.attachProject(hot); simulator.advance(0);
    assert.equal(simulator.getSnapshot().componentStates.device.status, "Temperature suspended");
  } else if (fixture === "wired-three-cell-monitor-controls-discharge") {
    const state = simulator.getSnapshot().componentStates.device;
    assert.equal(state.status, "Monitoring", JSON.stringify({ state, diagnostics: simulator.getSnapshot().diagnostics }));
    assert.equal(state.readings?.voltage, 10.8);
    assert.ok(Math.abs(state.readings?.current ?? Number.NaN) > 0.9);
    assert.ok(simulator.getSnapshot().serial.some(entry => Number(entry.text) === 10800));
    simulator.advance(1000);
    assert.ok((simulator.getSnapshot().componentStates.load.readings?.current ?? Number.NaN) > 0.9);
  } else assert.fail(`Missing executable assertion for ${fixture}`);
  simulator.pause(); const time = simulator.getSnapshot().timeMs;
  simulator.advance(1000); assert.equal(simulator.getSnapshot().timeMs, time);
});
test("expanded publication requires an actual registered model, example and named acceptance fixture", () => {
  for (const [id, definition] of Object.entries(EXPANDED_COMPONENTS)) {
    if (COMPONENT_CATALOG[id]) assert.deepEqual(publicationIssues(definition), [], id);
    else assert.ok(publicationIssues(definition).length > 0, id);
  }
  const existing = getComponentDefinition("cd74hc4067")!;
  assert.ok(publicationIssues({ ...existing, id: "untested-copy" }).some(i => i.includes("example")));
  assert.ok(publicationIssues({ ...existing, simulation: { ...existing.simulation!, model: "missing" } }).some(i => i.includes("model")));
});
