import test from "node:test";
import assert from "node:assert/strict";
import { OneWireRuntime, oneWireCrc, sensorRom } from "./one-wire.ts";
import { DeviceRuntime } from "./devices.ts";
import { DeviceWiring } from "./device-wiring.ts";
import { createDefaultBlinkProject } from "../circuit/default-project.ts";
import { createInitialPinStates } from "./pins.ts";
import type { CircuitProject } from "../circuit/types.ts";

function fixture(parasite = false) {
  const project: CircuitProject = { ...createDefaultBlinkProject(), components: [{ id: "uno", type: "arduino-uno", label: "Uno", x: 0, y: 0 }], connections: [] };
  const wire = (id: string, pin: string, other: string, to: string) => project.connections.push({ id: `w${project.connections.length}`, from: { componentId: id, pin }, to: { componentId: other, pin: to } });
  for (const [id, gpio, temperature] of [["a", 2, 20.125], ["b", 2, -10.25], ["isolated", 3, 42]] as const) {
    project.components.push({ id, type: "ds18b20", label: id, x: 0, y: 0, properties: { temperature } });
    project.components.push({ id: `${id}-r`, type: "resistor", label: "Pull-up", x: 0, y: 0, properties: { resistance: 4700 } });
    wire(id, "VDD", "uno", parasite ? "GND" : "5V"); wire(id, "GND", "uno", "GND");
    wire(id, "DQ", "uno", `D${gpio}`); wire(id, "DQ", `${id}-r`, "1"); wire(`${id}-r`, "2", "uno", "5V");
  }
  const runtime = new OneWireRuntime();
  const tick = (time: number) => runtime.tick(project, new DeviceWiring(project, createInitialPinStates()), time);
  tick(0);
  return { project, runtime, tick };
}

test("1-Wire discovery, CRC, addressed conversion and isolated buses", () => {
  const { runtime, tick } = fixture();
  assert.equal(runtime.transaction(2, "reset", []), 1);
  const a = runtime.transaction(2, "search", []) as number[], b = runtime.transaction(2, "search", []) as number[];
  assert.notDeepEqual(a, b); assert.equal(oneWireCrc(a), 0); assert.equal(oneWireCrc(b), 0);
  assert.equal(runtime.transaction(2, "search", []), 0);
  runtime.transaction(2, "select", [a]); runtime.transaction(2, "write", [0x44]);
  tick(749); assert.equal(runtime.temperature(runtime.parts(2)[0]), -127);
  tick(750); assert.equal(runtime.temperature(runtime.parts(2)[0]), 20.125);
  assert.equal(runtime.temperature(runtime.parts(2)[1]), 85);
  assert.equal(runtime.temperature(runtime.parts(3)[0]), 85);
  runtime.transaction(2, "write", [0xbe]);
  const scratchpad = Array.from({ length: 9 }, () => Number(runtime.transaction(2, "read", [])));
  assert.equal(oneWireCrc(scratchpad), 0);
  assert.equal((scratchpad[0] | scratchpad[1] << 8) / 16, 20.125);
});

test("conversion resolution, reset and parasite-power strong pull-up", () => {
  const { runtime, tick } = fixture(true);
  const sensor = runtime.parts(2)[0]; assert.ok(sensor);
  runtime.resolution(sensor, 9);
  assert.equal(runtime.convert([sensor], false), 93.75);
  tick(94); assert.equal(runtime.temperature(sensor), -127);
  runtime.convert([sensor], true); tick(188); assert.equal(runtime.temperature(sensor), 20);
  runtime.reset(); tick(0); assert.equal(runtime.temperature(sensor), 85);
});

test("disconnecting power or removing all bus pull-ups prevents discovery", () => {
  const f = fixture();
  f.project.connections = f.project.connections.filter(w => !(w.from.componentId === "a" && w.from.pin === "VDD"));
  f.tick(1); assert.deepEqual(f.runtime.parts(2).map(c => c.id), ["b"]);
  f.project.connections = f.project.connections.filter(w => !["a-r", "b-r"].includes(w.from.componentId));
  f.tick(2); assert.equal(f.runtime.parts(2).length, 0);
});

test("DallasTemperature addresses share conversion state with direct OneWire", () => {
  const { project } = fixture();
  const runtime = new DeviceRuntime(project, "OneWire bus(2); DallasTemperature sensor(&bus);");
  const evaluate = (text: string) => /^\d/.test(text) ? Number(text) : text;
  const call = (method: string, args: (number | string | number[])[] = [], name = "sensor") => runtime.invoke(name, method, args, evaluate);
  runtime.tick(0, createInitialPinStates()); call("begin");
  assert.equal(call("getDeviceCount"), 2);
  assert.equal(call("getAddress", ["address", 1]), 1);
  assert.deepEqual(runtime.values.get("address"), sensorRom("b"));
  call("setResolution", [sensorRom("b"), 10]); call("requestTemperaturesByAddress", [sensorRom("b")]);
  assert.equal(runtime.pendingDelayMs, 187.5);
  runtime.tick(188, createInitialPinStates());
  assert.equal(call("getTempC", [sensorRom("b")]), -10.25);
  assert.equal(call("getTempCByIndex", [0]), 85);
  assert.equal(call("reset", [], "bus"), 1);
  call("select", [sensorRom("b")], "bus"); call("write", [0xbe], "bus");
  const low = Number(call("read", [], "bus")), high = Number(call("read", [], "bus"));
  assert.equal(((low | high << 8) << 16 >> 16) / 16, -10.25);
});
