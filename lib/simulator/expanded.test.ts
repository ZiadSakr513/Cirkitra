import test from "node:test";
import assert from "node:assert/strict";
import { ArduinoSimulator, solveCircuit, compileArduinoSketch } from "./index.ts";
import { createDefaultBlinkProject, type CircuitProject } from "../circuit/index.ts";

function fixture(type: string) {
  const project: CircuitProject = { ...createDefaultBlinkProject(), components: [
    { id: "uno", type: "arduino-uno", label: "Uno", x: 0, y: 0 },
    { id: "dut", type, label: type, x: 500, y: 0 },
    { id: "motor", type: "dc-motor", label: "Motor", x: 800, y: 0 },
  ], connections: [] };
  const simulator = new ArduinoSimulator("void setup(){} void loop(){delay(10);}");
  let snapshot = simulator.getSnapshot(); let nextPin = 2;
  const wire = (fromId: string, from: string, toId: string, to: string) => project.connections.push({ id: `w${project.connections.length}`, from: { componentId: fromId, pin: from }, to: { componentId: toId, pin: to } });
  const rail = (pin: string, high = true) => wire("uno", high ? "5V" : "GND", "dut", pin);
  const drive = (pin: string, value: number) => {
    const number = nextPin++;
    snapshot = { ...snapshot, pins: snapshot.pins.map(p => p.number === number ? { ...p, mode: "OUTPUT", pwmValue: Math.round(value * 255), digitalValue: value >= 0.5 ? 1 : 0 } : p) };
    wire("uno", `D${number}`, "dut", pin);
  };
  return { project, rail, wire, drive, solve: () => solveCircuit(project, snapshot) };
}

for (const [type, count, prefix] of [["cd74hc4067", 16, "I"], ["cd74hc4051", 8, "A"]] as const) {
  test(`${type} selects every channel, supports reverse flow, and disconnects disabled channels`, () => {
    for (let selected = 0; selected < count; selected++) {
      const f = fixture(type); f.rail("VCC"); f.rail("GND", false);
      if (type === "cd74hc4051") f.rail("VEE", false);
      f.rail("E", false);
      for (let bit = 0; bit < Math.log2(count); bit++) f.drive(`S${bit}`, selected & (1 << bit) ? 1 : 0);
      for (let channel = 0; channel < count; channel++) f.rail(`${prefix}${channel}`, channel === selected);
      f.wire("dut", "COM", "uno", "A0");
      assert.equal(f.solve().analogInputs[14], 1023, `channel ${selected}`);
      f.project.connections = f.project.connections.filter(w => w.to.pin !== "E"); f.rail("E");
      assert.equal(f.solve().analogInputs[14], undefined, "disabled common floats");
    }
    const f = fixture(type); f.rail("VCC"); f.rail("GND", false); if (type === "cd74hc4051") f.rail("VEE", false);
    f.rail("E", false); for (let bit = 0; bit < Math.log2(count); bit++) f.rail(`S${bit}`, false);
    f.rail("COM"); f.wire("dut", `${prefix}0`, "uno", "A0");
    assert.equal(f.solve().analogInputs[14], 1023);
    f.project.connections = f.project.connections.filter(w => w.to.pin !== "VCC");
    assert.equal(f.solve().analogInputs[14], undefined);
  });
}

test("mux passes fractional signals, without joining unselected channels", () => {
  const f = fixture("cd74hc4051"); f.rail("VCC"); f.rail("GND", false); f.rail("VEE", false); f.rail("E", false);
  [0, 1, 2].forEach(bit => f.rail(`S${bit}`, false));
  f.drive("A0", 0.25); f.rail("A1"); f.wire("dut", "COM", "uno", "A0");
  assert.ok(Math.abs(f.solve().analogInputs[14] - 257) <= 1);
  f.project.connections = f.project.connections.filter(w => w.to.pin !== "S0"); f.rail("S0");
  assert.equal(f.solve().analogInputs[14], 1023);
  assert.ok(!f.solve().diagnostics.some(d => d.code === "output-contention"));
  f.rail("COM", false);
  assert.ok(f.solve().diagnostics.some(d => d.code === "output-contention"));
});

test("74HC138 implements the complete enable and active-low decoding table", () => {
  for (let enable = 0; enable < 8; enable++) for (let address = 0; address < 8; address++) {
    const f = fixture("74hc138"); f.rail("VCC"); f.rail("GND", false);
    [0, 1, 2].forEach(bit => { f.drive(`A${bit}`, address & (1 << bit) ? 1 : 0); f.drive(`E${bit + 1}`, enable & (1 << bit) ? 1 : 0); });
    const outputs = f.solve().componentStates.dut.channels!;
    for (let index = 0; index < 8; index++) assert.equal(outputs[`Y${index}`], enable === 4 && index === address ? 0 : 1);
  }
});

const configurations = [
  { type: "tb6612fng", supply: ["VCC", "VM1"], ground: ["GND", "PGND1_3", "PGND2_9"], awake: "STBY", inputs: ["AIN1", "AIN2"], outputs: ["AO1_1", "AO2_5"], pwm: "PWMA" },
  { type: "drv8833", supply: ["VM"], ground: ["GND", "AISEN", "BISEN"], awake: "nSLEEP", inputs: ["AIN1", "AIN2"], outputs: ["AOUT1", "AOUT2"] },
  { type: "l298", supply: ["VS", "VSS"], ground: ["GND", "SENSE_A", "SENSE_B"], inputs: ["IN1", "IN2"], outputs: ["OUT1", "OUT2"], pwm: "ENA" },
];
for (const config of configurations) test(`${config.type} models direction, PWM, braking, disables, and incomplete wiring`, () => {
  for (const reverse of [false, true]) for (const duty of [1, 0.5]) {
    const f = fixture(config.type); config.supply.forEach(pin => f.rail(pin)); config.ground.forEach(pin => f.rail(pin, false));
    if (config.awake) f.rail(config.awake);
    f.drive(config.inputs[reverse ? 1 : 0], config.pwm ? 1 : duty); f.drive(config.inputs[reverse ? 0 : 1], 0);
    if (config.pwm) f.drive(config.pwm, duty);
    f.wire("dut", config.outputs[0], "motor", "+"); f.wire("dut", config.outputs[1], "motor", "-");
    const running = f.solve().componentStates.motor;
    assert.equal(running.direction, reverse ? "reverse" : "forward"); assert.ok(Math.abs(running.speed! - duty) < 0.005);
    const connections = [...f.project.connections];
    for (const pin of [config.supply[0], config.ground[0], config.inputs[0], config.awake ?? config.pwm!]) {
      f.project.connections = connections.filter(w => !(w.to.componentId === "dut" && w.to.pin === pin));
      assert.equal(f.solve().componentStates.motor.powered, false, `missing ${pin}`);
    }
    f.project.connections = connections.filter(w => !(w.to.componentId === "motor" && w.to.pin === "-"));
    assert.equal(f.solve().componentStates.motor.powered, false);
    f.project.connections = connections.filter(w => !(w.to.componentId === "dut" && config.inputs.includes(w.to.pin)));
    config.inputs.forEach(pin => f.rail(pin));
    assert.equal(f.solve().componentStates.motor.direction, "brake");
  }
});

test("unpowered published devices never report fabricated activity and unknown libraries fail explicitly", () => {
  const f = fixture("bme280"); f.rail("VDD");
  assert.equal(f.solve().componentStates.dut.powered, false);
  const project = createDefaultBlinkProject(); project.components.push({ id: "draft", type: "unfinished-draft-part", label: "Draft part", x: 500, y: 0 });
  const simulator = new ArduinoSimulator(project.code); simulator.attachProject(project);
  assert.ok(simulator.getSnapshot().diagnostics.some(d => d.code === "component-unavailable"));
  assert.equal(simulator.run().status, "error");
  for (const code of ["#include <UnknownRadio.h>\nvoid setup(){} void loop(){}", "void setup(){ unknown.begin(1,2); } void loop(){}", "void setup(){int x = sensor.readTemperature();} void loop(){}"])
    assert.equal(compileArduinoSketch(code).valid, false);
  assert.equal(compileArduinoSketch('#include <Servo.h>\nServo arm; void setup(){arm.attach(9);arm.write(90);} void loop(){}').valid, true);
});

for (const config of configurations) test(`${config.type} runs two independent bridges and rejects conflicting output drives`, () => {
  const f = fixture(config.type); config.supply.forEach(pin => f.rail(pin)); config.ground.forEach(pin => f.rail(pin, false));
  if (config.awake) f.rail(config.awake);
  f.drive(config.inputs[0], config.pwm ? 1 : 0.5); f.drive(config.inputs[1], 0);
  if (config.pwm) f.drive(config.pwm, 0.5);
  f.wire("dut", config.outputs[0], "motor", "+"); f.wire("dut", config.outputs[1], "motor", "-");
  assert.ok(!f.solve().diagnostics.some(d => d.code === "floating-control"), "unused second channel has no diagnostic");
  f.project.components.push({ id: "second", type: "dc-motor", label: "Second motor", x: 800, y: 250 });
  const second = config.type === "l298" ? ["IN3", "IN4", "OUT3", "OUT4", "ENB"] : config.type === "tb6612fng" ? ["BIN1", "BIN2", "BO1_12", "BO2_8", "PWMB"] : ["BIN1", "BIN2", "BOUT1", "BOUT2"];
  f.drive(second[0], 0); f.drive(second[1], 1); if (second[4]) f.drive(second[4], 1);
  f.wire("dut", second[2], "second", "+"); f.wire("dut", second[3], "second", "-");
  assert.equal(f.solve().componentStates.motor.direction, "forward");
  assert.equal(f.solve().componentStates.second.direction, "reverse");
  assert.equal(f.solve().componentStates.second.speed, 1);
  f.rail(config.outputs[0], false);
  assert.equal(f.solve().componentStates.motor.powered, false);
  assert.ok(f.solve().diagnostics.some(d => d.code === "output-contention"));
});

test("DRV8833 brakes low on 11, coasts on 00, sleeps, and requires the used sense return", () => {
  const f = fixture("drv8833"); f.rail("VM"); f.rail("GND", false); f.rail("AISEN", false); f.rail("nSLEEP");
  f.rail("AIN1"); f.rail("AIN2"); f.wire("dut", "AOUT1", "motor", "+"); f.wire("dut", "AOUT2", "motor", "-");
  assert.deepEqual(f.solve().componentStates.dut.channels, { AOUT1: 0, AOUT2: 0 });
  assert.equal(f.solve().componentStates.motor.direction, "brake");
  f.project.connections = f.project.connections.filter(w => !["AIN1", "AIN2"].includes(w.to.pin));
  f.rail("AIN1", false); f.rail("AIN2", false);
  assert.equal(f.solve().componentStates.motor.direction, "coast");
  f.project.connections = f.project.connections.filter(w => w.to.pin !== "AIN1"); f.rail("AIN1");
  assert.equal(f.solve().componentStates.motor.powered, true);
  const active = [...f.project.connections];
  f.project.connections = active.filter(w => w.to.pin !== "AISEN");
  assert.equal(f.solve().componentStates.motor.powered, false);
  f.project.connections = active.filter(w => w.to.pin !== "nSLEEP"); f.rail("nSLEEP", false);
  assert.equal(f.solve().componentStates.motor.direction, "coast");
});

test("TB6612 PWM low brakes but standby low floats both outputs", () => {
  const f = fixture("tb6612fng"); ["VCC", "VM2", "STBY", "AIN1"].forEach(pin => f.rail(pin));
  ["GND", "PGND1_4", "AIN2", "PWMA"].forEach(pin => f.rail(pin, false));
  f.wire("dut", "AO1_2", "motor", "+"); f.wire("dut", "AO2_6", "motor", "-");
  assert.equal(f.solve().componentStates.motor.direction, "brake");
  f.project.connections = f.project.connections.filter(w => w.to.pin !== "STBY"); f.rail("STBY", false);
  assert.equal(f.solve().componentStates.motor.direction, "coast");
});
