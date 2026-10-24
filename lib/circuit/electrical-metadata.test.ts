import assert from "node:assert/strict";
import test from "node:test";
import { repairDualBmeI2cMuxWiring, repairExplicitA4988ControlWiring, repairExplicitA4988ModeStraps, repairExplicitCommonGroundWiring, repairExplicitI2cPeripheralBus, repairExplicitMotorSupplyConnections, repairExplicitTb6612StandbyWiring, repairMissingPowerConnections, repairMotorDriverOutputConnections, repairUnsafeSupplyConnections, validatePartWiring } from "./electrical-metadata.ts";
import { COMPONENT_EXAMPLES } from "./component-examples.ts";
import { COMPONENT_CATALOG } from "./catalog.ts";
import type { CircuitProject } from "./types.ts";
import { validateProjectNetEndpointCompatibility } from "./net-validation.ts";

function project(components: CircuitProject["components"], connections: CircuitProject["connections"]): CircuitProject {
  return {
    schemaVersion: 1,
    id: "electrical-test",
    name: "Electrical metadata test",
    description: "",
    board: "arduino-uno",
    components,
    connections,
    code: "void setup() {} void loop() {}",
  };
}

test("completes the selected shared I2C bus for multiple screenshot sensor/display modules", () => {
  const input = project([
    { id: "board", type: "esp32-devkit-v1-30pin", label: "DOIT ESP32 DevKit V1", x: 0, y: 0, properties: {} },
    { id: "lux", type: "veml7700-light-sensor", label: "VEML7700", x: 250, y: 0, properties: {} },
    { id: "display", type: "sh1107-oled-128x128", label: "SH1107 OLED", x: 450, y: 0, properties: {} },
  ], [
    { id: "lux-vcc", from: { componentId: "board", pin: "3V3" }, to: { componentId: "lux", pin: "VIN" } },
    { id: "lux-gnd", from: { componentId: "board", pin: "GND" }, to: { componentId: "lux", pin: "GND" } },
    { id: "display-vcc", from: { componentId: "board", pin: "3V3" }, to: { componentId: "display", pin: "VCC" } },
    { id: "display-gnd", from: { componentId: "board", pin: "GND2" }, to: { componentId: "display", pin: "GND" } },
  ]);
  input.board = "esp32-devkit-v1-30pin";
  input.code = "#include <Wire.h>\nvoid setup(){ Wire.begin(); }\nvoid loop(){ Wire.beginTransmission(0x10); Wire.endTransmission(); Wire.beginTransmission(0x3C); Wire.endTransmission(); }";
  const result = repairExplicitI2cPeripheralBus(input, "Use the DOIT ESP32 DevKit V1 30-pin board on GPIO21 SDA and GPIO22 SCL for the VEML7700 and SH1107 OLED.");
  assert.equal(result.repairs.length, 4);
  for (const componentId of ["lux", "display"]) {
    assert.ok(result.project.connections.some(wire => [wire.from, wire.to].some(endpoint => endpoint.componentId === componentId && endpoint.pin === "SDA")
      && [wire.from, wire.to].some(endpoint => endpoint.componentId === "board" && endpoint.pin === "GPIO21")));
    assert.ok(result.project.connections.some(wire => [wire.from, wire.to].some(endpoint => endpoint.componentId === componentId && endpoint.pin === "SCL")
      && [wire.from, wire.to].some(endpoint => endpoint.componentId === "board" && endpoint.pin === "GPIO22")));
  }
});

test("corrects only explicitly requested XIAO I2C signals that were swapped onto each other's GPIOs", () => {
  const input = project([
    { id: "xiao", type: "xiao-esp32s3-sense", label: "Seeed XIAO ESP32-S3 Sense", x: 0, y: 0, properties: {} },
    { id: "co2", type: "scd41-co2-sensor", label: "SCD41", x: 250, y: 0, properties: {} },
    { id: "oled", type: "ssd1306-oled-128x64", label: "SSD1306 OLED", x: 450, y: 0, properties: {} },
  ], [
    { id: "co2-sda-wrong", from: { componentId: "xiao", pin: "D5" }, to: { componentId: "co2", pin: "SDA" } },
    { id: "co2-scl-wrong", from: { componentId: "xiao", pin: "D4" }, to: { componentId: "co2", pin: "SCL" } },
    { id: "oled-sda-wrong", from: { componentId: "xiao", pin: "D5" }, to: { componentId: "oled", pin: "SDA" } },
    { id: "oled-scl-wrong", from: { componentId: "xiao", pin: "D4" }, to: { componentId: "oled", pin: "SCL" } },
    { id: "co2-vcc", from: { componentId: "xiao", pin: "3V3" }, to: { componentId: "co2", pin: "VDD" } },
    { id: "oled-vcc", from: { componentId: "xiao", pin: "3V3" }, to: { componentId: "oled", pin: "VCC" } },
    { id: "co2-ground", from: { componentId: "xiao", pin: "GND" }, to: { componentId: "co2", pin: "GND" } },
    { id: "oled-ground", from: { componentId: "xiao", pin: "GND" }, to: { componentId: "oled", pin: "GND" } },
  ]);
  input.board = "xiao-esp32s3-sense";
  input.code = "#include <Wire.h>\nvoid setup(){ Wire.begin(D4,D5); } void loop(){}";

  const repaired = repairExplicitI2cPeripheralBus(input, "Use the Seeed XIAO ESP32-S3 Sense D4/D5 I2C bus for SDA/SCL, with the SCD41 and SSD1306 OLED.");
  assert.equal(repaired.repairs.length, 4);
  for (const componentId of ["co2", "oled"]) {
    assert.ok(repaired.project.connections.some(wire => [wire.from, wire.to].some(endpoint => endpoint.componentId === componentId && endpoint.pin === "SDA")
      && [wire.from, wire.to].some(endpoint => endpoint.componentId === "xiao" && endpoint.pin === "D4")));
    assert.ok(repaired.project.connections.some(wire => [wire.from, wire.to].some(endpoint => endpoint.componentId === componentId && endpoint.pin === "SCL")
      && [wire.from, wire.to].some(endpoint => endpoint.componentId === "xiao" && endpoint.pin === "D5")));
  }
  assert.deepEqual(validateProjectNetEndpointCompatibility(repaired.project.components, repaired.project.connections, Object.values(COMPONENT_CATALOG))
    .filter(issue => issue.code === "NET_PIN_CONTENTION"), []);
});

test("joins explicitly common-ground symbols and floating device returns to the selected board ground", () => {
  const input = project([
    { id: "uno", type: "arduino-uno", label: "Arduino Uno", x: 0, y: 0, properties: {} },
    { id: "sensor", type: "dht11", label: "DHT11", x: 0, y: 0, properties: {} },
    { id: "led", type: "led", label: "Status LED", x: 0, y: 0, properties: {} },
    { id: "ground", type: "ground", label: "Ground", x: 0, y: 0, properties: {} },
  ], [
    { id: "led-return", from: { componentId: "led", pin: "K" }, to: { componentId: "ground", pin: "GND" } },
  ]);
  const repaired = repairExplicitCommonGroundWiring(input, "Join all board and module returns to a common ground.");
  assert.equal(repaired.repairs.length, 2);
  assert.ok(repaired.project.connections.some(wire => [wire.from, wire.to].some(endpoint => endpoint.componentId === "ground" && endpoint.pin === "GND")
    && [wire.from, wire.to].some(endpoint => endpoint.componentId === "uno" && endpoint.pin === "GND")));
  assert.ok(repaired.project.connections.some(wire => [wire.from, wire.to].some(endpoint => endpoint.componentId === "sensor" && endpoint.pin === "GND")
    && [wire.from, wire.to].some(endpoint => endpoint.componentId === "uno" && endpoint.pin === "GND")));
  assert.equal(repairExplicitCommonGroundWiring(input, "Keep the returns isolated.").project, input);
});

test("writes explicit common-ground wires for each separate board ground pad", () => {
  const input = project([
    { id: "board", type: "esp32-devkit-v1-30pin", label: "DOIT ESP32 DevKit V1", x: 0, y: 0, properties: {} },
    { id: "sensor", type: "veml7700-light-sensor", label: "VEML7700", x: 0, y: 0, properties: {} },
    { id: "display", type: "sh1107-oled-128x128", label: "OLED", x: 0, y: 0, properties: {} },
  ], [
    { id: "sensor-ground", from: { componentId: "board", pin: "GND" }, to: { componentId: "sensor", pin: "GND" } },
    { id: "display-ground", from: { componentId: "board", pin: "GND2" }, to: { componentId: "display", pin: "GND" } },
  ]);
  const repaired = repairExplicitCommonGroundWiring(input, "Power the sensor and OLED from 3V3 with common ground.");
  assert.ok(repaired.project.connections.some(wire =>
    [wire.from, wire.to].some(endpoint => endpoint.componentId === "board" && endpoint.pin === "GND2")
      && [wire.from, wire.to].some(endpoint => endpoint.componentId === "board" && endpoint.pin === "GND")));
});

test("joins a push-button terminal 2 ground symbol to the controller when explicitly requested", () => {
  const input = project([
    { id: "uno", type: "arduino-uno", label: "Arduino Uno", x: 0, y: 0, properties: {} },
    { id: "button", type: "push-button", label: "Mute Button", x: 0, y: 0, properties: {} },
    { id: "button-ground", type: "ground", label: "Button Ground", x: 0, y: 0, properties: {} },
  ], [
    { id: "button-return", from: { componentId: "button", pin: "2" }, to: { componentId: "button-ground", pin: "GND" } },
  ]);
  const repaired = repairExplicitCommonGroundWiring(input, "Connect push-button terminal 2 to the same Uno GND pin.");
  assert.ok(repaired.project.connections.some(wire =>
    [wire.from, wire.to].some(endpoint => endpoint.componentId === "button-ground" && endpoint.pin === "GND")
      && [wire.from, wire.to].some(endpoint => endpoint.componentId === "uno" && endpoint.pin === "GND")));
  const connections = repaired.project.connections;
  const net = new Set(["button:2"]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const wire of connections) {
      const a = `${wire.from.componentId}:${wire.from.pin}`, b = `${wire.to.componentId}:${wire.to.pin}`;
      if (net.has(a) && !net.has(b)) { net.add(b); changed = true; }
      if (net.has(b) && !net.has(a)) { net.add(a); changed = true; }
    }
  }
  assert.ok(net.has("uno:GND"), "button terminal 2 is connected through its ground symbol to the board return");
});

test("joins directly requested device returns to the named controller ground", () => {
  const input = project([
    { id: "board", type: "xiao-esp32s3-sense", label: "XIAO", x: 0, y: 0 },
    { id: "sensor", type: "scd41-co2-sensor", label: "SCD41", x: 0, y: 0 },
    { id: "gnd", type: "ground", label: "GND", x: 0, y: 0 },
  ], [
    { id: "sensor-return", from: { componentId: "sensor", pin: "GND" }, to: { componentId: "gnd", pin: "GND" } },
  ]);
  const repair = repairExplicitCommonGroundWiring(input, "Join every GND and LED cathode to XIAO GND.");
  assert.equal(repair.repairs.length, 1);
  assert.deepEqual(repair.project.connections.at(-1)?.from, { componentId: "gnd", pin: "GND" });
  assert.deepEqual(repair.project.connections.at(-1)?.to, { componentId: "board", pin: "GND" });
});

test("joins a servo supply negative to the controller return when the prompt names that connection", () => {
  const input = project([
    { id: "xiao", type: "xiao-esp32s3-sense", label: "XIAO ESP32-S3 Sense", x: 0, y: 0, properties: {} },
    { id: "servo", type: "sg90-servo", label: "Pan Servo", x: 0, y: 0, properties: {} },
    { id: "supply", type: "dc-supply", label: "5 V Supply", x: 0, y: 0, properties: { voltage: 5 } },
  ], [
    { id: "servo-negative", from: { componentId: "supply", pin: "-" }, to: { componentId: "servo", pin: "GND" } },
  ]);
  const repaired = repairExplicitCommonGroundWiring(input, "Use an external regulated 5 V DC supply for the servo, connect its negative to XIAO GND.");
  assert.ok(repaired.project.connections.some(wire =>
    [wire.from, wire.to].some(endpoint => endpoint.componentId === "supply" && endpoint.pin === "-")
      && [wire.from, wire.to].some(endpoint => endpoint.componentId === "xiao" && endpoint.pin === "GND")));
});

test("recognizes a directly stated supply-minus-to-board-ground connection", () => {
  const input = project([
    { id: "xiao", type: "xiao-esp32s3-sense", label: "XIAO ESP32-S3", x: 0, y: 0, properties: {} },
    { id: "supply", type: "dc-supply", label: "5 V Supply", x: 0, y: 0, properties: { voltage: 5 } },
    { id: "servo-a", type: "sg90-servo", label: "Servo A", x: 0, y: 0, properties: {} },
    { id: "servo-b", type: "sg90-servo", label: "Servo B", x: 0, y: 0, properties: {} },
    { id: "ground", type: "ground", label: "Ground", x: 0, y: 0, properties: {} },
  ], [
    { id: "supply-return", from: { componentId: "supply", pin: "-" }, to: { componentId: "ground", pin: "GND" } },
    { id: "servo-a-return", from: { componentId: "servo-a", pin: "GND" }, to: { componentId: "supply", pin: "-" } },
    { id: "servo-b-return", from: { componentId: "servo-b", pin: "GND" }, to: { componentId: "supply", pin: "-" } },
  ]);
  const repaired = repairExplicitCommonGroundWiring(input, "Wire supply - directly to XIAO GND and both servo GND pins.");
  assert.ok(repaired.project.connections.some(wire =>
    [wire.from, wire.to].some(endpoint => endpoint.componentId === "ground" && endpoint.pin === "GND")
      && [wire.from, wire.to].some(endpoint => endpoint.componentId === "xiao" && endpoint.pin === "GND")));
  const returnNet = new Set(["supply:-"]);
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const wire of repaired.project.connections) {
      const from = `${wire.from.componentId}:${wire.from.pin}`;
      const to = `${wire.to.componentId}:${wire.to.pin}`;
      if (returnNet.has(from) && !returnNet.has(to)) { returnNet.add(to); expanded = true; }
      if (returnNet.has(to) && !returnNet.has(from)) { returnNet.add(from); expanded = true; }
    }
  }
  assert.ok(returnNet.has("xiao:GND"), "the supply negative and controller ground share the same return net");
});

test("does not attach a ground pin whose existing net contains a GPIO signal", () => {
  const input = project([
    { id: "uno", type: "arduino-uno", label: "Arduino Uno", x: 0, y: 0, properties: {} },
    { id: "sensor", type: "dht11", label: "DHT11", x: 0, y: 0, properties: {} },
  ], [
    { id: "unsafe", from: { componentId: "sensor", pin: "GND" }, to: { componentId: "uno", pin: "D3" } },
  ]);
  const repaired = repairExplicitCommonGroundWiring(input, "The circuit must use common ground.");
  assert.equal(repaired.repairs.length, 0);
  assert.equal(repaired.project, input);
});

test("applies only explicitly requested A4988 full-step straps", () => {
  const input = project([
    { id: "mega", type: "arduino-mega-2560", label: "Mega", x: 0, y: 0, properties: {} },
    { id: "driver", type: "a4988-stepper-driver", label: "A4988", x: 0, y: 0, properties: {} },
  ], [
    { id: "gnd1", from: { componentId: "mega", pin: "GND" }, to: { componentId: "driver", pin: "GND_14" } },
    { id: "wrong-reset-control", from: { componentId: "mega", pin: "D5" }, to: { componentId: "driver", pin: "RST" } },
    { id: "wrong-sleep-control", from: { componentId: "mega", pin: "D6" }, to: { componentId: "driver", pin: "SLP" } },
  ]);
  const prompt = "Tie RESET to SLP and set MS1/MS2/MS3 low for full steps.";
  const repaired = repairExplicitA4988ModeStraps(input, prompt);
  assert.equal(repaired.repairs.length, 4);
  for (const pin of ["RST", "MS1", "MS2", "MS3"]) {
    assert.ok(repaired.project.connections.some(wire => [wire.from, wire.to].some(endpoint => endpoint.componentId === "driver" && endpoint.pin === pin)));
  }
  assert.equal(repaired.project.connections.some(wire => wire.id === "wrong-reset-control" || wire.id === "wrong-sleep-control"), false);
  const highReset = repairExplicitA4988ModeStraps(input, "Tie RESET to SLP and wire that joined net directly to VDD/5V so it remains HIGH; set MS1/MS2/MS3 low for full steps.");
  assert.ok(highReset.project.connections.some(wire =>
    [wire.from, wire.to].some(endpoint => endpoint.componentId === "driver" && endpoint.pin === "RST")
      && [wire.from, wire.to].some(endpoint => endpoint.componentId === "driver" && endpoint.pin === "VDD")), "an explicitly requested active-high reset strap reaches the driver's logic rail");
  assert.equal(repairExplicitA4988ModeStraps(input, "Use the A4988 in microstep mode.").project, input);
});

test("repairs direct over-voltage sensor supply wires using a compatible board rail", () => {
  const input = project([
    { id: "uno", type: "arduino-uno", label: "Arduino Uno", x: 0, y: 0, properties: {} },
    { id: "sensor", type: "bme280", label: "BME280", x: 0, y: 0, properties: {} },
  ], [
    { id: "vdd", from: { componentId: "uno", pin: "5V" }, to: { componentId: "sensor", pin: "VDD" } },
    { id: "vddio", from: { componentId: "sensor", pin: "VDDIO" }, to: { componentId: "uno", pin: "5V" } },
    { id: "ground1", from: { componentId: "sensor", pin: "GND_1" }, to: { componentId: "uno", pin: "GND" } },
    { id: "ground7", from: { componentId: "sensor", pin: "GND_7" }, to: { componentId: "uno", pin: "GND2" } },
  ]);

  const result = repairUnsafeSupplyConnections(input);
  assert.equal(result.repairs.length, 2);
  assert.deepEqual(result.project.connections.slice(0, 2).map(connection => connection.from.componentId === "uno" ? connection.from.pin : connection.to.pin), ["3V3", "3V3"]);
  assert.deepEqual(validatePartWiring(result.project), []);
  assert.equal(input.connections[0].from.pin, "5V", "input project remains unchanged");
});

test("moves a three-volt HC-SR04 VCC connection to the required five-volt rail", () => {
  const input = project([
    { id: "esp32", type: "esp32-nodemcu-32s", label: "ESP32 NodeMCU-32S", x: 0, y: 0, properties: {} },
    { id: "sonar", type: "hc-sr04", label: "HC-SR04", x: 0, y: 0, properties: {} },
  ], [
    { id: "unsafe-vcc", from: { componentId: "esp32", pin: "3V3" }, to: { componentId: "sonar", pin: "VCC" } },
  ]);
  const repaired = repairUnsafeSupplyConnections(input);
  assert.equal(repaired.repairs.length, 1);
  assert.equal(repaired.project.connections[0]?.from.pin, "5V");
  assert.equal(repaired.project.connections[0]?.to.pin, "VCC");
});

test("keeps a board rail when its voltage is within the component's supply range", () => {
  const input = project([
    { id: "uno", type: "arduino-uno", label: "Arduino Uno", x: 0, y: 0, properties: {} },
    { id: "sensor", type: "ds18b20", label: "DS18B20", x: 0, y: 0, properties: {} },
  ], [
    { id: "vdd", from: { componentId: "uno", pin: "5V" }, to: { componentId: "sensor", pin: "VDD" } },
  ]);

  const result = repairUnsafeSupplyConnections(input);
  assert.equal(result.repairs.length, 0);
  assert.equal(result.project, input);
});

test("repairs missing sensor power and ground only when each net has one compatible choice", () => {
  const input = project([
    { id: "uno", type: "arduino-uno", label: "Arduino Uno", x: 0, y: 0, properties: {} },
    { id: "sensor", type: "bme280", label: "BME280", x: 0, y: 0, properties: {} },
  ], []);
  const repaired = repairMissingPowerConnections(input);
  assert.equal(repaired.repairs.length, 4);
  assert.deepEqual(repaired.repairs.map(repair => [repair.pin, repair.sourcePin, repair.volts]), [
    ["VDD", "3V3", 3.3], ["VDDIO", "3V3", 3.3],
    ["GND_1", "GND", "GND"], ["GND_7", "GND", "GND"],
  ]);
  assert.deepEqual(validatePartWiring(repaired.project), []);
  assert.equal(input.connections.length, 0, "the rejected input project remains unchanged");

  const ambiguous = project([
    ...input.components,
    { id: "supply", type: "dc-supply", label: "Second 3.3 V source", x: 0, y: 0, properties: { voltage: 3.3, enabled: true } },
  ], [{ id: "return", from: { componentId: "uno", pin: "GND" }, to: { componentId: "supply", pin: "-" } }]);
  const leftAmbiguous = repairMissingPowerConnections(ambiguous);
  assert.equal(leftAmbiguous.repairs.some(repair => repair.pin === "VDD" || repair.pin === "VDDIO"), false);
  assert.ok(validatePartWiring(leftAmbiguous.project).some(issue => issue.code === "supply-not-connected" && issue.message.includes("BME280 supply pin VDD")));
});

test("routes a sole explicitly requested motor supply to a driver instead of leaving it on the MCU VIN pin", () => {
  const input = COMPONENT_EXAMPLES.tb6612fng();
  input.components.push({ id: "motor-supply", type: "dc-supply", label: "Adjustable motor supply", x: 400, y: 0, properties: { voltage: 7.4, enabled: true } });
  input.connections = input.connections.filter(connection =>
    ![connection.from, connection.to].some(endpoint => endpoint.componentId === "device" && ["VM1", "VM2", "VM3"].includes(endpoint.pin)));
  input.connections.push(...["VM1", "VM2", "VM3"].map(pin => ({
    id: `wrong-${pin}`,
    from: { componentId: "device", pin },
    to: { componentId: "uno", pin: "VIN" },
  })));

  const repaired = repairExplicitMotorSupplyConnections(input, "Use the TB6612FNG with a separate adjustable motor supply.");
  assert.equal(repaired.repairs.length, 1);
  const connected = (candidate: CircuitProject, start: { componentId: string; pin: string }, target: { componentId: string; pin: string }) => {
    const pending = [`${start.componentId}:${start.pin}`]; const seen = new Set<string>();
    while (pending.length) {
      const current = pending.pop()!;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const wire of candidate.connections) {
        if (`${wire.from.componentId}:${wire.from.pin}` === current) pending.push(`${wire.to.componentId}:${wire.to.pin}`);
        if (`${wire.to.componentId}:${wire.to.pin}` === current) pending.push(`${wire.from.componentId}:${wire.from.pin}`);
      }
    }
    return seen.has(`${target.componentId}:${target.pin}`);
  };
  for (const pin of ["VM1", "VM2", "VM3"]) assert.ok(connected(repaired.project, { componentId: "device", pin }, { componentId: "motor-supply", pin: "+" }), `${pin} uses the explicit motor source`);
  assert.ok(connected(repaired.project, { componentId: "motor-supply", pin: "-" }, { componentId: "uno", pin: "GND" }), "the separate supply shares the board return");
  assert.ok(validatePartWiring(repaired.project).every(issue => issue.severity !== "error"), "the repaired wiring introduces no electrical errors");
  assert.ok(validatePartWiring(repaired.project).every(issue => !issue.code.startsWith("supply-") && !issue.code.startsWith("ground-")), "all driver supplies and returns resolve");
  assert.equal(input.connections.some(connection => connection.id.startsWith("wrong-")), true, "the input candidate remains unchanged");

  const flattened = structuredClone(input);
  flattened.connections = flattened.connections.filter(connection => !connection.id.startsWith("wrong-"));
  flattened.connections.push(
    { id: "star-vin", from: { componentId: "device", pin: "VM1" }, to: { componentId: "uno", pin: "VIN" } },
    { id: "star-vm2", from: { componentId: "device", pin: "VM1" }, to: { componentId: "device", pin: "VM2" } },
    { id: "star-vm3", from: { componentId: "device", pin: "VM1" }, to: { componentId: "device", pin: "VM3" } },
  );
  const flattenedRepair = repairExplicitMotorSupplyConnections(flattened, "Use the TB6612FNG with a separate adjustable motor supply.");
  assert.equal(flattenedRepair.repairs.length, 1, "a flattened multi-pin power net must still be repairable");
  for (const pin of ["VM1", "VM2", "VM3"]) assert.ok(connected(flattenedRepair.project, { componentId: "device", pin }, { componentId: "motor-supply", pin: "+" }), `${pin} remains on the explicit source after net flattening`);
  assert.ok(!connected(flattenedRepair.project, { componentId: "motor-supply", pin: "+" }, { componentId: "uno", pin: "VIN" }), "external motor supply is isolated from the board VIN rail");
  assert.ok(validatePartWiring(flattenedRepair.project).every(issue => issue.severity !== "error"), "flattened-net repair passes electrical validation");

  const ambiguous = structuredClone(input);
  ambiguous.components.push({ id: "second-supply", type: "dc-supply", label: "Second supply", x: 500, y: 0, properties: { voltage: 7.4, enabled: true } });
  assert.deepEqual(repairExplicitMotorSupplyConnections(ambiguous, "Use a separate motor supply.").repairs, [], "multiple candidate sources are left for model repair");
});

test("repairs only the explicit dual-zone BME280 mux bus gaps while preserving pull-up nets", () => {
  const components: CircuitProject["components"] = [
    { id: "uno", type: "arduino-uno", label: "Arduino Uno", x: 0, y: 0, properties: {} },
    { id: "mux", type: "tca9548a", label: "TCA9548A", x: 0, y: 0, properties: {} },
    { id: "io", type: "mcp23017", label: "MCP23017", x: 0, y: 0, properties: {} },
    { id: "west", type: "bme280", label: "West BME280", x: 0, y: 0, properties: {} },
    { id: "east", type: "bme280", label: "East BME280", x: 0, y: 0, properties: {} },
    ...["west-sda", "west-scl", "east-sda", "east-scl"].map((id, index) => ({ id, type: "resistor", label: "4.7k pull-up", x: index * 10, y: 0, properties: { resistance: 4700 } })),
  ];
  const connections: CircuitProject["connections"] = [
    { id: "mux-sda", from: { componentId: "mux", pin: "SDA" }, to: { componentId: "uno", pin: "A4" } },
    { id: "mux-scl", from: { componentId: "mux", pin: "SCL" }, to: { componentId: "uno", pin: "A5" } },
    ...(["west", "east"] as const).flatMap(zone => [
      { id: `${zone}-sda-pullup`, from: { componentId: zone, pin: "SDI" }, to: { componentId: `${zone}-sda`, pin: "1" } },
      { id: `${zone}-scl-pullup`, from: { componentId: zone, pin: "SCK" }, to: { componentId: `${zone}-scl`, pin: "1" } },
      { id: `${zone}-sda-vcc`, from: { componentId: `${zone}-sda`, pin: "2" }, to: { componentId: "uno", pin: "3V3" } },
      { id: `${zone}-scl-vcc`, from: { componentId: `${zone}-scl`, pin: "2" }, to: { componentId: "uno", pin: "3V3" } },
      { id: `${zone}-vdd`, from: { componentId: zone, pin: "VDD" }, to: { componentId: "uno", pin: "3V3" } },
      { id: `${zone}-vddio`, from: { componentId: zone, pin: "VDDIO" }, to: { componentId: "uno", pin: "3V3" } },
      { id: `${zone}-csb`, from: { componentId: zone, pin: "CSB" }, to: { componentId: "uno", pin: "3V3" } },
      { id: `${zone}-sdo`, from: { componentId: zone, pin: "SDO" }, to: { componentId: "uno", pin: "GND" } },
      { id: `${zone}-gnd1`, from: { componentId: zone, pin: "GND_1" }, to: { componentId: "uno", pin: "GND" } },
      { id: `${zone}-gnd7`, from: { componentId: zone, pin: "GND_7" }, to: { componentId: "uno", pin: "GND2" } },
    ]),
    { id: "mux-vcc", from: { componentId: "mux", pin: "VCC" }, to: { componentId: "uno", pin: "3V3" } },
    { id: "mux-gnd", from: { componentId: "mux", pin: "GND" }, to: { componentId: "uno", pin: "GND" } },
    { id: "io-vdd", from: { componentId: "io", pin: "VDD" }, to: { componentId: "uno", pin: "3V3" } },
    { id: "io-vss", from: { componentId: "io", pin: "VSS" }, to: { componentId: "uno", pin: "GND" } },
  ];
  const input = project(components, connections);
  const request = "Use one TCA9548A and two BME280 sensors, West on channel 0 and East on channel 1, plus one MCP23017.";
  const code = "TCA9548 mux(0x70); void loop(){ mux.selectChannel(0); mux.selectChannel(1); }";
  const repaired = repairDualBmeI2cMuxWiring(input, request, code);
  assert.equal(repaired.repairs.length, 6, "MCP upstream SDA/SCL and four downstream sensor bus leads are completed");
  const connected = (aId: string, aPin: string, bId: string, bPin: string) => {
    const pending = [`${aId}:${aPin}`]; const seen = new Set<string>();
    while (pending.length) {
      const at = pending.pop()!; if (seen.has(at)) continue; seen.add(at);
      for (const wire of repaired.project.connections) {
        if (`${wire.from.componentId}:${wire.from.pin}` === at) pending.push(`${wire.to.componentId}:${wire.to.pin}`);
        if (`${wire.to.componentId}:${wire.to.pin}` === at) pending.push(`${wire.from.componentId}:${wire.from.pin}`);
      }
    }
    return seen.has(`${bId}:${bPin}`);
  };
  assert.ok(connected("io", "SDA", "uno", "A4"));
  assert.ok(connected("io", "SCL", "uno", "A5"));
  assert.ok(connected("west", "SDI", "mux", "SD0"));
  assert.ok(connected("west", "SCK", "mux", "SC0"));
  assert.ok(connected("east", "SDI", "mux", "SD1"));
  assert.ok(connected("east", "SCK", "mux", "SC1"));
  assert.equal(input.connections.length, connections.length, "repair does not mutate the input project");
  assert.equal(repairDualBmeI2cMuxWiring(input, "Use a TCA9548A", code).repairs.length, 0, "does not repair without explicit matching scope");

  const ambiguous = structuredClone(input);
  ambiguous.connections.push({ id: "west-wrong-active-net", from: { componentId: "west", pin: "SDI" }, to: { componentId: "io", pin: "GPA0" } });
  assert.equal(repairDualBmeI2cMuxWiring(ambiguous, request, code).repairs.length, 0, "does not guess across an existing active-component connection");
});

test("restores a missing TB6612 STBY wire only for the explicitly mapped, sketch-driven GPIO", () => {
  const input = COMPONENT_EXAMPLES.tb6612fng();
  input.connections = input.connections.filter(connection =>
    ![connection.from, connection.to].some(endpoint => endpoint.componentId === "device" && endpoint.pin === "STBY"));
  input.code = "const int stbyPin = 8; void setup(){ pinMode(stbyPin, OUTPUT); digitalWrite(stbyPin, HIGH); } void loop(){}";
  const prompt = "Use Uno pins D6 and D7 for direction, D5 for PWM, and D8 for STBY.";
  const repaired = repairExplicitTb6612StandbyWiring(input, prompt, input.code);
  assert.deepEqual(repaired.repairs, [{ driverId: "device", boardId: "uno", boardPin: "D8" }]);
  assert.ok(repaired.project.connections.some(connection =>
    [connection.from, connection.to].some(endpoint => endpoint.componentId === "device" && endpoint.pin === "STBY")
      && [connection.from, connection.to].some(endpoint => endpoint.componentId === "uno" && endpoint.pin === "D8")));
  assert.equal(input.connections.some(connection => [connection.from, connection.to].some(endpoint => endpoint.pin === "STBY")), false, "input is not mutated");
  assert.equal(repairExplicitTb6612StandbyWiring(input, prompt, "void setup(){} void loop(){}").repairs.length, 0, "does not wire a GPIO the sketch does not drive");

  const wronglyPowered = structuredClone(input);
  wronglyPowered.connections.push({ id: "stby-to-3v3", from: { componentId: "uno", pin: "3V3" }, to: { componentId: "device", pin: "STBY" } });
  const corrected = repairExplicitTb6612StandbyWiring(wronglyPowered, prompt, input.code);
  assert.deepEqual(corrected.repairs, [{ driverId: "device", boardId: "uno", boardPin: "D8" }]);
  assert.equal(corrected.project.connections.some(connection => connection.id === "stby-to-3v3"), false, "replaces an explicit but incorrect rail tie");
  assert.ok(corrected.project.connections.some(connection => connection.from.componentId === "uno" && connection.from.pin === "D8" && connection.to.componentId === "device" && connection.to.pin === "STBY"));

  const occupiedPin = structuredClone(input);
  occupiedPin.connections.push({ id: "d8-used", from: { componentId: "uno", pin: "D8" }, to: { componentId: "motor", pin: "+" } });
  assert.equal(repairExplicitTb6612StandbyWiring(occupiedPin, prompt, input.code).repairs.length, 0, "does not short a GPIO already serving another active component");
});

test("repairs only missing or wrong A4988 STEP/DIR/EN wires when prompt and sketch agree", () => {
  const input = COMPONENT_EXAMPLES["a4988-stepper-driver"]!();
  const board = input.components.find(component => component.type === "arduino-uno")!;
  board.type = "arduino-mega-2560";
  input.board = "arduino-mega-2560";
  input.connections = input.connections.filter(connection => ![connection.from, connection.to].some(endpoint =>
    endpoint.componentId === "device" && ["STEP", "DIR", "EN"].includes(endpoint.pin)));
  input.connections.push({ id: "wrong-step-pin", from: { componentId: board.id, pin: "D8" }, to: { componentId: "device", pin: "STEP" } });
  input.code = "const int stepPin=2; const int dirPin=3; const int enablePin=4; void setup(){ pinMode(stepPin,OUTPUT); pinMode(dirPin,OUTPUT); pinMode(enablePin,OUTPUT); } void loop(){ digitalWrite(stepPin,HIGH); delayMicroseconds(2); digitalWrite(stepPin,LOW); }";
  const prompt = "Connect STEP/DIR/EN to Mega D2/D3/D4.";
  const repaired = repairExplicitA4988ControlWiring(input, prompt, input.code);
  assert.deepEqual(repaired.repairs.map(repair => [repair.driverPin, repair.boardPin]), [["STEP", "D2"], ["DIR", "D3"], ["EN", "D4"]]);
  assert.equal(repaired.project.connections.some(connection => connection.id === "wrong-step-pin"), false);
  assert.equal(repaired.project.connections.filter(connection => [connection.from, connection.to].some(endpoint => endpoint.componentId === "device" && ["STEP", "DIR", "EN"].includes(endpoint.pin))).length, 3);
  const commaDeclared = repairExplicitA4988ControlWiring(input, prompt, "const int stepPin=2, dirPin=3, enPin=4; void loop(){ digitalWrite(stepPin,HIGH); }");
  assert.deepEqual(commaDeclared.repairs.map(repair => [repair.driverPin, repair.boardPin]), [["STEP", "D2"], ["DIR", "D3"], ["EN", "D4"]]);
  assert.equal(repairExplicitA4988ControlWiring(input, prompt, "void setup(){} void loop(){}").repairs.length, 0, "does not guess pin assignments when sketch mapping is absent");
});

test("supply voltage checks resolve the top of a series battery stack", () => {
  const bms = COMPONENT_EXAMPLES.bq76920();
  const warnings = validatePartWiring(bms).filter(issue => issue.code === "supply-voltage-range");
  assert.deepEqual(warnings, [], "three series cells provide 10.8 V at the BQ76920 BAT and REGSRC pins");
});

test("requires both DC motor leads to span one complete H-bridge channel", () => {
  const complete = COMPONENT_EXAMPLES.tb6612fng();
  assert.deepEqual(validatePartWiring(complete), []);

  const openLead = structuredClone(complete);
  openLead.connections = openLead.connections.filter(connection =>
    ![connection.from, connection.to].some(endpoint => endpoint.componentId === "motor-a" && endpoint.pin === "-"));
  assert.ok(validatePartWiring(openLead).some(issue => issue.code === "motor-terminal-open" && issue.message.includes("motor-a")));

  const wrongBridge = structuredClone(complete);
  wrongBridge.connections = wrongBridge.connections.filter(connection =>
    ![connection.from, connection.to].some(endpoint => endpoint.componentId === "motor-a" && endpoint.pin === "-"));
  wrongBridge.connections.push({
    id: "wrong-motor-return",
    from: { componentId: "device", pin: "AO1_1" },
    to: { componentId: "motor-a", pin: "-" },
  });
  const shortIssue = validatePartWiring(wrongBridge).find(issue => issue.code === "motor-terminals-shorted");
  assert.ok(shortIssue);
  assert.match(shortIssue.message, /AO1_1\/AO1_2/);
});

test("reports the exact wire path for an indirect H-bridge motor short", () => {
  const shorted = COMPONENT_EXAMPLES.tb6612fng();
  shorted.connections.push(
    { id: "short-path-a", from: { componentId: "device", pin: "AO1_1" }, to: { componentId: "uno", pin: "GND" } },
    { id: "short-path-b", from: { componentId: "uno", pin: "GND" }, to: { componentId: "device", pin: "AO2_5" } },
  );
  const diagnostic = validatePartWiring(shorted).find(issue => issue.code === "motor-terminals-shorted");
  assert.ok(diagnostic);
  assert.deepEqual(diagnostic.wireIds.sort(), ["short-path-a", "short-path-b", "wire-16", "wire-17"].sort());
  assert.ok(diagnostic.componentIds.includes("motor-a"));
  assert.ok(diagnostic.componentIds.includes("device"));
  assert.ok(diagnostic.nets[0]?.endpoints.some(endpoint => endpoint.componentId === "uno" && endpoint.pin === "GND"));
  assert.match(diagnostic.expectedTopology, /different output nets/);
  assert.deepEqual(repairMotorDriverOutputConnections(shorted).repairs, [], "an indirect path is reported for Gemini instead of being guessed at");
});

test("repairs TB6612FNG duplicate output pads mistakenly used as opposite motor terminals", () => {
  const malformed = COMPONENT_EXAMPLES.tb6612fng();
  const negative = malformed.connections.find(connection =>
    [connection.from, connection.to].some(endpoint => endpoint.componentId === "motor-a" && endpoint.pin === "-"));
  assert.ok(negative);
  const output = negative.from.componentId === "device" ? negative.from : negative.to;
  output.pin = "AO1_2";
  assert.ok(validatePartWiring(malformed).some(issue => issue.code === "motor-terminals-shorted"));

  const repaired = repairMotorDriverOutputConnections(malformed);
  assert.equal(repaired.repairs.length, 1);
  assert.equal(repaired.repairs[0].channel, 1);
  assert.deepEqual(validatePartWiring(repaired.project), []);
  const repairedNegative = repaired.project.connections.find(connection =>
    [connection.from, connection.to].some(endpoint => endpoint.componentId === "motor-a" && endpoint.pin === "-"));
  assert.ok(repairedNegative);
  assert.ok([repairedNegative.from, repairedNegative.to].some(endpoint => endpoint.componentId === "device" && endpoint.pin === "AO2_5"));
  assert.equal(output.pin, "AO1_2", "the rejected input project remains unchanged");
});

test("removes a direct wire that shorts opposing H-bridge outputs", () => {
  const malformed = COMPONENT_EXAMPLES.tb6612fng();
  malformed.connections.push({
    id: "short-output-a1-to-a2",
    from: { componentId: "device", pin: "AO1_1" },
    to: { componentId: "device", pin: "AO2_5" },
  });
  assert.ok(validatePartWiring(malformed).some(issue => issue.code === "motor-terminals-shorted"));

  const repaired = repairMotorDriverOutputConnections(malformed);
  assert.deepEqual(repaired.outputShortRepairs, [{ driverId: "device", driverType: "tb6612fng", channel: 1 }]);
  assert.ok(!repaired.project.connections.some(connection => connection.id === "short-output-a1-to-a2"));
  assert.deepEqual(validatePartWiring(repaired.project), []);
  assert.ok(malformed.connections.some(connection => connection.id === "short-output-a1-to-a2"), "the rejected source project remains unchanged");
});

test("repairs TB6612FNG motor leads split between unrelated bridge channels", () => {
  const malformed = COMPONENT_EXAMPLES.tb6612fng();
  const negative = malformed.connections.find(connection =>
    [connection.from, connection.to].some(endpoint => endpoint.componentId === "motor-a" && endpoint.pin === "-"));
  assert.ok(negative);
  const output = negative.from.componentId === "device" ? negative.from : negative.to;
  output.pin = "BO2_7";
  const splitIssue = validatePartWiring(malformed).find(issue => issue.code === "motor-driver-output-wiring");
  assert.ok(splitIssue);
  assert.match(splitIssue.message, /Current wiring: \+ -> .*channel A/);
  assert.match(splitIssue.message, /- -> .*channel B/);

  const repaired = repairMotorDriverOutputConnections(malformed);
  assert.equal(repaired.repairs.length, 1);
  assert.deepEqual(validatePartWiring(repaired.project), []);
});

test("leaves correct and ambiguous motor-driver wiring unchanged", () => {
  const complete = COMPONENT_EXAMPLES.tb6612fng();
  assert.equal(repairMotorDriverOutputConnections(complete).project, complete);

  const ambiguous = structuredClone(complete);
  ambiguous.components.push({ id: "other-driver", type: "tb6612fng", label: "Other driver", x: 1_000, y: 0, properties: {} });
  const repair = repairMotorDriverOutputConnections(ambiguous);
  assert.equal(repair.project, ambiguous);
  assert.equal(repair.repairs.length, 0);
});
