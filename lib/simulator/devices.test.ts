import test from "node:test";
import assert from "node:assert/strict";
import { DeviceRuntime } from "./devices.ts";
import { getComponentDefinition } from "../circuit/catalog.ts";
import { createDefaultBlinkProject } from "../circuit/default-project.ts";
import { createInitialPinStates } from "./pins.ts";
import { compileArduinoSketch } from "./parser.ts";
import { ArduinoSimulator } from "./engine.ts";
import type { CircuitProject } from "../circuit/types.ts";

function fixture(type: string, source: string) {
  const project: CircuitProject = { ...createDefaultBlinkProject(), components: [{ id: "uno", type: "arduino-uno", label: "Uno", x: 0, y: 0 }, { id: "dut", type, label: type, x: 500, y: 0 }], connections: [] };
  const wire = (id: string, pin: string, other: string, to: string) => project.connections.push({ id: `w${project.connections.length}`, from: { componentId: id, pin }, to: { componentId: other, pin: to } });
  const rail = (pin: string, source = "3V3") => wire("dut", pin, "uno", source);
  const def = getComponentDefinition(type)!;
  for (const s of def.metadata!.supplies) s.pins.forEach(pin => rail(pin));
  def.metadata!.groundPins.forEach(pin => rail(pin, "GND"));
  const i2c = (sda = "SDA", scl = "SCL") => {
    wire("dut", sda, "uno", "A4"); wire("dut", scl, "uno", "A5");
    [sda, scl].forEach((pin, index) => {
      const id = `r${index}`; project.components.push({ id, type: "resistor", label: "Pull-up", x: 250, y: index * 100, properties: { resistance: 4700 } });
      wire("dut", pin, id, "1"); wire(id, "2", "uno", "3V3");
    });
  };
  const pins = createInitialPinStates(); const runtime = new DeviceRuntime(project, source);
  const value = (text: string): number | string => /^\d/.test(text) ? Number(text) : text;
  return { project, wire, rail, i2c, pins, runtime, tick: (time = 0) => runtime.tick(time, pins), call: (method: string, args: (number | string)[] = [], name = "sensor") => runtime.invoke(name, method, args, value) };
}
for (const [type, header, klass] of [["bme280", "Adafruit_BME280.h", "Adafruit_BME280"], ["bmp280", "Adafruit_BMP280.h", "Adafruit_BMP280"]]) {
  test(`${type} adapter reads environmental values only on the powered addressed bus`, () => {
    const f = fixture(type, `#include <${header}>\n${klass} sensor;`); f.i2c("SDI", "SCK"); f.rail("CSB"); f.rail("SDO", "GND"); f.tick();
    assert.equal(f.call("begin", [0x76]), 1); assert.equal(f.call("readTemperature"), 25);
    f.project.components[1].properties = { temperature: -8, pressure: 98000 }; f.tick();
    assert.equal(f.call("readTemperature"), -8); assert.equal(f.call("readPressure"), 98000);
    assert.equal(f.call("begin", [0x77]), 0);
    f.project.connections = f.project.connections.filter(w => w.from.pin !== "VDD"); f.tick();
    assert.equal(f.call("begin", [0x76]), 0); assert.ok(Number.isNaN(f.call("readTemperature")));
  });
}
test("MCP23017 outputs and TCA9548 channel isolation are stateful", () => {
  const f = fixture("mcp23017", "Adafruit_MCP23X17 sensor;"); f.i2c(); f.rail("RESET"); ["A0", "A1", "A2"].forEach(pin => f.rail(pin, "GND")); f.tick();
  assert.equal(f.call("begin_I2C", [0x20]), 1); f.call("pinMode", [0, 1]); f.call("digitalWrite", [0, 1]); f.tick();
  assert.ok(f.runtime.drives.some(d => d.pin === "GPA0" && d.value === 1));
  const mux = fixture("tca9548a", "TCA9548 sensor(112);"); mux.i2c(); mux.rail("RESET"); ["A0", "A1", "A2"].forEach(pin => mux.rail(pin, "GND")); mux.tick();
  assert.equal(mux.runtime.bridges.length, 0); assert.equal(mux.call("begin"), 1); mux.call("selectChannel", [3]); mux.tick();
  assert.deepEqual(mux.runtime.bridges.map(b => b.to), ["SD3", "SC3"]); mux.call("closeAll"); mux.tick(); assert.equal(mux.runtime.bridges.length, 0);
});
test("sensor calls in expressions and structured result calls compile", () => {
  const result = compileArduinoSketch('#include <Adafruit_BME280.h>\nAdafruit_BME280 sensor; void setup(){sensor.begin(0x76);} void loop(){float t = sensor.readTemperature(); Serial.println(t); delay(1000);}');
  assert.equal(result.valid, true, JSON.stringify(result.diagnostics));
});

test("unsupported overloads fail inside expressions as well as standalone calls", () => {
  const result = compileArduinoSketch('#include <Adafruit_BME280.h>\nAdafruit_BME280 sensor; void setup(){} void loop(){float t = sensor.readTemperature(123); Serial.println(t);}');
  assert.equal(result.valid, false);
  assert.ok(result.diagnostics.some(d => d.code === "UNSUPPORTED_LIBRARY_OVERLOAD"));
});

test("DHT22 sampling interval, Fahrenheit and missing pull-up", () => {
  const f = fixture("dht22", "DHT sensor(2, DHT22);");
  f.wire("dut", "DATA", "uno", "D2");
  f.project.components.push({ id: "pullup", type: "resistor", label: "Pull-up", x: 0, y: 0, properties: { resistance: 4700 } });
  f.wire("dut", "DATA", "pullup", "1"); f.wire("pullup", "2", "uno", "3V3");
  f.tick(); f.call("begin"); assert.equal(f.call("readTemperature", [1]), 77);
  f.project.components[1].properties = { temperature: 30, humidity: 70 };
  f.tick(1000); assert.equal(f.call("readTemperature"), 25);
  assert.ok(Number.isNaN(f.call("readTemperature", [0, 1])));
  f.tick(2000); assert.equal(f.call("readHumidity"), 70); assert.equal(f.call("readTemperature"), 30);
  f.project.connections = f.project.connections.filter(w => w.from.componentId !== "pullup");
  f.tick(4000); assert.ok(Number.isNaN(f.call("readTemperature")));
});

test("I2C address conflicts and changed address straps do not silently rebind adapters", () => {
  const f = fixture("bmp280", "Adafruit_BMP280 sensor;"); f.i2c("SDI", "SCK"); f.rail("CSB"); f.rail("SDO", "GND"); f.tick();
  assert.equal(f.call("begin", [0x76]), 1);
  f.project.connections = f.project.connections.filter(w => w.from.pin !== "SDO"); f.rail("SDO"); f.tick();
  assert.ok(Number.isNaN(f.call("readTemperature")));
  f.project.components.push({ ...f.project.components[1], id: "duplicate" });
  for (const w of [...f.project.connections].filter(w => w.from.componentId === "dut")) f.wire("duplicate", w.from.pin, w.to.componentId, w.to.pin);
  f.tick(); assert.equal(f.call("begin", [0x77]), 0);
  assert.ok(f.runtime.diagnostics.some(d => d.code === "I2C_ADDRESS_CONFLICT"));
});

test("MPU range settings affect every raw axis and sleep suppresses data ready", () => {
  const f = fixture("mpu-6050", "Adafruit_MPU6050 sensor;"); f.i2c(); f.rail("AD0", "GND");
  f.project.components[1].properties = { ax: 9.80665, ay: 9.80665, az: 9.80665, gx: Math.PI, gy: Math.PI, gz: Math.PI };
  f.tick(); assert.equal(f.call("begin"), 1);
  f.call("setAccelerometerRange", [1]); f.call("setGyroRange", [1]); f.call("enableDataReadyInterrupt", [1]); f.tick();
  assert.ok(f.runtime.drives.some(d => d.pin === "INT" && d.value === 1));
  f.call("beginTransmission", [0x68], "Wire"); f.call("write", [0x3b], "Wire"); f.call("endTransmission", [], "Wire");
  assert.equal(f.call("requestFrom", [0x68, 14], "Wire"), 14);
  const data = Array.from({ length: 14 }, () => Number(f.call("read", [], "Wire")));
  assert.deepEqual([0, 2, 4].map(i => data[i] << 8 | data[i + 1]), [8192, 8192, 8192]);
  assert.deepEqual([8, 10, 12].map(i => data[i] << 8 | data[i + 1]), [11790, 11790, 11790]);
  f.call("enableSleep", [1]); f.tick(); assert.equal(f.runtime.drives.some(d => d.pin === "INT" && d.value === 1), false);
  assert.equal(f.call("getEvent", ["a", "g", "t"]), 0);
});

test("SHT31 direct bus commands and adapter share heater and timed measurement state", () => {
  const f = fixture("sht31-dis", "Adafruit_SHT31 sensor;"); f.i2c(); f.rail("nRESET"); f.rail("ADDR", "GND"); f.tick();
  assert.equal(f.call("begin"), 1);
  const command = (a: number, b: number) => { f.call("beginTransmission", [0x44], "Wire"); f.call("write", [a], "Wire"); f.call("write", [b], "Wire"); return f.call("endTransmission", [], "Wire"); };
  assert.equal(command(0x30, 0x6d), 0); assert.equal(f.call("isHeaterEnabled"), 1);
  assert.equal(command(0x24, 0x00), 0); assert.equal(f.call("requestFrom", [0x44, 6], "Wire"), 0);
  f.tick(15); assert.equal(f.call("requestFrom", [0x44, 6], "Wire"), 6);
  f.project.components[1].properties = { temperature: 32, humidity: 20 }; f.tick(16);
  assert.equal(f.call("readTemperature"), 32); assert.equal(f.runtime.pendingDelayMs, 15);
  f.project.connections = f.project.connections.filter(w => w.from.pin !== "nRESET"); f.rail("nRESET", "GND"); f.tick(50);
  assert.equal(command(0x24, 0x00), 2); assert.equal(f.call("begin"), 0);
});

test("byte buffers support declaration, indexed assignment and expression reads", () => {
  const code = "void setup(){byte payload[3] = {1, 2, 3}; payload[1] = 9; int sum = payload[0] + payload[1]; Serial.println(sum);} void loop(){delay(1000);}";
  const project = createDefaultBlinkProject(); project.code = code;
  const simulator = new ArduinoSimulator(code); simulator.attachProject(project);
  assert.equal(simulator.getCompiledSketch().valid, true, JSON.stringify(simulator.getCompiledSketch().diagnostics));
  simulator.run(); simulator.advance(0);
  assert.equal(simulator.getSnapshot().serial.at(-1)?.text, "10");
});

test("unpublished project data survives import but both run and step are blocked", () => {
  const project = createDefaultBlinkProject(); project.components.push({ id: "draft", type: "unfinished-draft-part", label: "Draft part", x: 500, y: 0 });
  const original = JSON.stringify(project);
  const simulator = new ArduinoSimulator(project.code); simulator.attachProject(project);
  assert.equal(simulator.step().status, "error");
  simulator.reset(); assert.equal(simulator.run().status, "error");
  assert.ok(simulator.getSnapshot().diagnostics.some(d => d.code === "component-unavailable" && d.message.includes("Draft part")));
  assert.equal(JSON.stringify(project), original);
});

test("LoRa library, SPI and virtual peer obey actual host wiring", () => {
  const f = fixture("rfm95w", "#include <LoRa.h>");
  for (const [pin, gpio] of [["MOSI", "D11"], ["MISO", "D12"], ["SCK", "D13"], ["NSS", "D10"], ["RESET", "D9"], ["DIO0", "D2"]]) f.wire("dut", pin, "uno", gpio);
  f.tick(); assert.equal(f.call("begin", [915000000], "LoRa"), 1);
  f.call("receive", [], "LoRa"); assert.equal(f.runtime.injectPacket("dut", "hi"), true);
  assert.equal(f.call("parsePacket", [], "LoRa"), 2); assert.equal(f.call("read", [], "LoRa"), 104); assert.equal(f.call("read", [], "LoRa"), 105);
  f.call("beginPacket", [], "LoRa"); f.call("print", ["test"], "LoRa"); f.call("endPacket", [], "LoRa");
  assert.equal(f.runtime.pendingDelayMs, 4); f.tick(4); assert.match(f.runtime.states.dut.packets!.at(-1)!.status, /Delivered/);
  const select = f.pins.find(p => p.label === "D10")!; select.mode = "OUTPUT"; select.pwmValue = 0; f.tick(5);
  f.call("beginTransaction", [0], "SPI"); f.call("transfer", [0x42], "SPI"); assert.equal(f.call("transfer", [0], "SPI"), 0x12); f.call("endTransaction", [], "SPI");
  f.call("receive", [], "LoRa");
  f.project.connections = f.project.connections.filter(w => w.from.pin !== "MOSI"); f.tick(6);
  assert.equal(f.runtime.injectPacket("dut", "blocked"), false); assert.equal(f.call("begin", [915000000], "LoRa"), 0);
});

test("XBee library request and response objects use the wired UART API model", () => {
  const source = "SoftwareSerial port(2, 3); XBee radio; XBeeAddress64 address(0x0013a200, 1); byte payload[2] = {65, 66}; ZBTxRequest request(address, payload, 2); ZBTxStatusResponse result; ZBRxResponse received;";
  const f = fixture("xbee-s2c-zigbee-th", source); f.rail("RESET"); f.rail("DIO8", "GND"); f.wire("dut", "DOUT", "uno", "D2"); f.wire("dut", "DIN", "uno", "D3");
  f.tick(); f.call("begin", [9600], "port"); f.call("setSerial", ["port"], "radio"); f.tick(100);
  f.call("readPacket", [], "radio"); assert.equal(f.call("getApiId", [], "radio__response"), 0x8a);
  f.call("send", ["request"], "radio"); f.tick(102); f.call("readPacket", [], "radio");
  assert.equal(f.call("getApiId", [], "radio__response"), 0x8b);
  f.call("getZBTxStatusResponse", ["result"], "radio__response"); assert.equal(f.call("getDeliveryStatus", [], "result"), 0);
  assert.equal(f.runtime.injectPacket("dut", "ok"), true); f.call("readPacket", [], "radio"); f.call("getZBRxResponse", ["received"], "radio__response");
  assert.equal(f.call("getDataLength", [], "received"), 2); assert.equal(f.call("getData", [1], "received"), 107);
  f.project.connections = f.project.connections.filter(w => w.from.pin !== "DIN"); f.tick(103); assert.equal(f.runtime.injectPacket("dut", "blocked"), false);
});

test("XBee conventional response chaining and request constructors compile", () => {
  const source = '#include <XBee.h>\n#include <SoftwareSerial.h>\nSoftwareSerial port(2,3); XBee radio; XBeeAddress64 address(0x0013a200,1); byte payload[2]={65,66}; ZBTxRequest request = ZBTxRequest(address,payload,sizeof(payload)); ZBTxStatusResponse result; void setup(){port.begin(9600); radio.setSerial(port);} void loop(){radio.send(request); delay(10); radio.readPacket(); if(radio.getResponse().isAvailable()){radio.getResponse().getZBTxStatusResponse(result); Serial.println(result.getDeliveryStatus());} delay(1000);}';
  const compiled = compileArduinoSketch(source); assert.equal(compiled.valid, true, JSON.stringify(compiled.diagnostics));
});

test("wired BQ27441 reads load current, declining charge and live raw I2C voltage", () => {
  const f = fixture("bq27441-g1", "#include <SparkFunBQ27441.h>"); f.i2c();
  f.project.connections = f.project.connections.filter(w => w.from.pin !== "BAT");
  f.project.components.push({ id: "cell", type: "battery-cell", label: "Battery", x: 0, y: 0, properties: { initialSoc: 50, capacityMah: 1000 } }, { id: "load", type: "dc-load", label: "Load", x: 0, y: 0, properties: { resistance: 3.59 } }, { id: "sense", type: "resistor", label: "Sense", x: 0, y: 0, properties: { resistance: 0.01 } }, { id: "bin", type: "resistor", label: "Insertion", x: 0, y: 0, properties: { resistance: 10000 } });
  f.wire("cell", "+", "dut", "BAT"); f.wire("cell", "-", "uno", "GND"); f.wire("load", "+", "cell", "+"); f.wire("load", "-", "sense", "1"); f.wire("sense", "2", "cell", "-");
  f.wire("dut", "SRP", "sense", "2"); f.wire("dut", "SRN", "sense", "1"); f.wire("dut", "BIN", "bin", "1"); f.wire("bin", "2", "uno", "GND");
  f.tick(); assert.equal(f.call("begin", [], "lipo"), 1); assert.equal(f.call("voltage", [], "lipo"), 3600); assert.equal(f.call("current", [], "lipo"), -1000);
  assert.equal(f.call("capacity", [], "lipo"), 500); assert.equal(f.call("temperature", [], "lipo"), 2982);
  f.tick(360000); assert.equal(f.call("soc", [], "lipo"), 40);
  f.tick(360000); f.call("beginTransmission", [0x55], "Wire"); f.call("write", [4], "Wire"); f.call("endTransmission", [], "Wire"); f.call("requestFrom", [0x55, 2], "Wire");
  const millivolts = Number(f.call("read", [], "Wire")) | Number(f.call("read", [], "Wire")) << 8;
  assert.equal(millivolts, f.call("voltage", [], "lipo"));
  f.project.connections = f.project.connections.filter(w => w.from.pin !== "SRN"); f.tick(360001); assert.ok(Number.isNaN(f.call("current", [], "lipo")));
});

test("74HC595 shift, latch, clear, output-enable and chained registers stay independent", () => {
  const f = fixture("74hc595", ""); f.rail("MR"); f.rail("OE", "GND");
  f.wire("dut", "DS", "uno", "D2"); f.wire("dut", "SHCP", "uno", "D3"); f.wire("dut", "STCP", "uno", "D4");
  f.project.components.push({ ...f.project.components[1], id: "second" });
  for (const pin of ["VCC", "GND", "MR", "OE", "SHCP", "STCP"]) f.wire("second", pin, "dut", pin);
  f.wire("second", "DS", "dut", "Q7S");
  const set = (number: number, high: boolean) => { const pin = f.pins[number]; pin.mode = "OUTPUT"; pin.pwmValue = high ? 255 : 0; pin.digitalValue = high ? 1 : 0; };
  set(2, false); set(3, false); set(4, false); f.tick();
  for (let bit = 15; bit >= 0; bit--) { set(2, !!(0xa55a & 1 << bit)); set(3, false); f.tick(); set(3, true); f.tick(); }
  const outputs = (id: string) => f.runtime.drives.filter(d => d.componentId === id && /^Q\d$/.test(d.pin)).reduce((value, d) => value | d.value << Number(d.pin.slice(1)), 0);
  assert.equal(outputs("dut"), 0, "shift clock alone cannot change output latch");
  set(4, true); f.tick(); assert.equal(outputs("dut"), 0x5a); assert.equal(outputs("second"), 0xa5);
  f.project.connections = f.project.connections.filter(w => !(w.from.componentId === "dut" && w.from.pin === "MR")); f.rail("MR", "GND"); f.tick();
  assert.equal(outputs("dut"), 0x5a, "clear only clears the shift register");
  set(4, false); f.tick(); set(4, true); f.tick(); assert.equal(outputs("dut"), 0);
  f.project.connections = f.project.connections.filter(w => !(w.from.componentId === "dut" && w.from.pin === "OE")); f.rail("OE"); f.tick();
  assert.equal(f.runtime.drives.some(d => /^Q\d$/.test(d.pin)), false);
});

test("MCP23017 interrupt capture, mirrored open-drain outputs and raw GPIO reads", () => {
  const f = fixture("mcp23017", "Adafruit_MCP23X17 sensor;"); f.i2c(); f.rail("RESET"); ["A0", "A1", "A2"].forEach(pin => f.rail(pin, "GND"));
  f.wire("dut", "GPA0", "uno", "D2"); const input = f.pins[2]; input.mode = "OUTPUT"; input.pwmValue = 255; f.tick();
  f.call("begin_I2C"); f.call("setupInterruptPin", [0, 1]); f.runtime.invoke("sensor", "setupInterrupts", [1, 1, 0], Number); f.tick();
  input.pwmValue = 0; f.tick(); assert.equal(f.call("getLastInterruptPin"), 0);
  assert.deepEqual(f.runtime.drives.filter(d => d.pin.startsWith("INT")).map(d => [d.pin, d.value]), [["INTA", 0], ["INTB", 0]]);
  f.call("beginTransmission", [0x20], "Wire"); f.call("write", [0x12], "Wire"); f.call("endTransmission", [], "Wire"); f.call("requestFrom", [0x20, 1], "Wire");
  assert.equal(f.call("read", [], "Wire"), 0); f.tick(); assert.equal(f.call("getLastInterruptPin"), 255);
  assert.equal(f.runtime.drives.some(d => d.pin.startsWith("INT")), false, "inactive open-drain interrupts float");
});

test("BQ24074 charge current changes battery charge and follows temperature, enable and input power", () => {
  const f = fixture("bq24074", "");
  f.project.connections = f.project.connections.filter(w => w.from.pin !== "IN"); f.rail("IN", "5V");
  ["CE", "EN1", "EN2"].forEach(pin => f.rail(pin, "GND"));
  f.project.components.push({ id: "cell", type: "battery-cell", label: "Cell", x: 0, y: 0, properties: { initialSoc: 50, capacityMah: 1000, temperature: 25 } }, { id: "load", type: "dc-load", label: "System", x: 0, y: 0, properties: { resistance: 440 } });
  f.wire("cell", "+", "dut", "BAT_3"); f.wire("cell", "-", "uno", "GND"); f.wire("load", "+", "dut", "OUT_11"); f.wire("load", "-", "uno", "GND");
  for (const [pin, resistance] of [["ISET", 1780], ["ILIM", 1610], ["TS", 10000]] as const) {
    const id = `r-${pin}`; f.project.components.push({ id, type: "resistor", label: pin, x: 0, y: 0, properties: { resistance } }); f.wire("dut", pin, id, "1"); f.wire(id, "2", "uno", "GND");
  }
  f.tick(); f.tick(); f.tick();
  assert.ok(Math.abs(f.runtime.states.load.readings!.voltage - 4.4) < 0.001);
  assert.ok(Math.abs(f.runtime.states.dut.readings!.chargeCurrent - 0.09) < 0.001);
  f.tick(360000); assert.ok(f.runtime.states.cell.readings!.soc > 50.8);
  f.project.components.find(c => c.id === "cell")!.properties!.temperature = 55; f.tick(360000);
  assert.equal(f.runtime.states.dut.status, "Temperature suspended"); assert.equal(f.runtime.states.dut.readings!.chargeCurrent, 0);
  f.project.components.find(c => c.id === "cell")!.properties!.temperature = 25;
  f.project.connections = f.project.connections.filter(w => !(w.from.componentId === "dut" && w.from.pin === "CE")); f.rail("CE"); f.tick(360000);
  assert.equal(f.runtime.states.dut.status, "Charge disabled");
  f.project.connections = f.project.connections.filter(w => w.from.pin !== "IN"); f.tick(360000); f.tick(360000);
  assert.equal(f.runtime.states.dut.status, "Battery power"); assert.ok(f.runtime.states.load.readings!.voltage > 3);
  const charge = f.runtime.states.cell.readings!.soc; f.tick(720000); assert.ok(f.runtime.states.cell.readings!.soc < charge);
});

test("BQ24074 programmable ITERM terminates charge, recharge restarts, and TMR expires deterministically", () => {
  const makeCharger = (soc: number, capacityMah: number, tmrOhms: number) => {
    const f = fixture("bq24074", ""); f.project.connections = f.project.connections.filter(w => w.from.pin !== "IN"); f.rail("IN", "5V"); ["CE", "EN1", "EN2"].forEach(pin => f.rail(pin, "GND"));
    f.project.components.push({ id: "cell", type: "battery-cell", label: "Cell", x: 0, y: 0, properties: { initialSoc: soc, capacityMah, temperature: 25 } });
    f.wire("cell", "+", "dut", "BAT_3"); f.wire("cell", "-", "uno", "GND");
    for (const [pin, resistance] of [["ISET", 1780], ["ILIM", 1610], ["TS", 10000], ["ITERM", 5000], ["TMR", tmrOhms]] as const) {
      const id = `r-${pin}`; f.project.components.push({ id, type: "resistor", label: pin, x: 0, y: 0, properties: { resistance } }); f.wire("dut", pin, id, "1"); f.wire(id, "2", "uno", "GND");
    }
    f.tick(); return f;
  };
  const full = makeCharger(95, 100, 46400);
  full.tick(900000);
  full.tick(900001);
  assert.equal(full.runtime.states.dut.status, "Charge complete", JSON.stringify(full.runtime.states.dut));
  assert.equal(full.runtime.states.dut.readings!.chargeCurrent, 0);
  const recharging = makeCharger(90, 100, 46400);
  assert.ok(recharging.runtime.states.dut.readings!.chargeCurrent > 0);
  const timed = makeCharger(50, 1000, 18000);
  timed.tick(8_640_000);
  assert.equal(timed.runtime.states.dut.status, "Safety timer expired");
  assert.equal(timed.runtime.states.dut.readings!.chargeCurrent, 0);
});

function bq769Fixture(soc = [50, 50, 50], temperature = [25, 25, 25], loadConnected = true) {
  const f = fixture("bq76920", "bq769x0 sensor(bq76920, 0x08);"); f.i2c();
  f.project.connections = f.project.connections.filter(w => !["BAT", "REGSRC"].includes(w.from.pin));
  for (let i = 0; i < soc.length; i++) {
    const id = `cell${i}`; f.project.components.push({ id, type: "battery-cell", label: id, x: 0, y: 0, properties: { initialSoc: soc[i], capacityMah: 1000, temperature: temperature[i] } });
    if (i) f.wire(id, "-", `cell${i - 1}`, "+");
    f.wire("dut", `VC${i}`, id, "-"); f.wire("dut", `VC${i + 1}`, id, "+");
  }
  f.wire("cell0", "-", "uno", "GND");
  for (let tap = soc.length + 1; tap <= 5; tap++) f.wire("dut", `VC${tap}`, "dut", `VC${tap - 1}`);
  f.wire("dut", "BAT", `cell${soc.length - 1}`, "+"); f.wire("dut", "REGSRC", `cell${soc.length - 1}`, "+");
  f.project.components.push({ id: "sense", type: "resistor", label: "Sense", x: 0, y: 0, properties: { resistance: 0.01 } }, { id: "ts", type: "resistor", label: "Thermistor", x: 0, y: 0, properties: { resistance: 10000 } }, { id: "load", type: "dc-load", label: "Load", x: 0, y: 0, properties: { resistance: 10.8 } }, { id: "switch", type: "ideal-mosfet", label: "Discharge switch", x: 0, y: 0 });
  f.wire("dut", "TS1", "ts", "1"); f.wire("ts", "2", "uno", "GND");
  f.wire("dut", "SRP", "sense", "2"); f.wire("dut", "SRN", "sense", "1"); f.wire("sense", "2", "uno", "GND");
  if (loadConnected) { f.wire("load", "+", `cell${soc.length - 1}`, "+"); f.wire("load", "-", "switch", "D"); f.wire("switch", "S", "sense", "1"); f.wire("dut", "DSG", "switch", "G"); }
  return f;
}

test("BQ76920 monitors a wired three-cell stack and protection actually interrupts load current", () => {
  const f = bq769Fixture();
  f.tick(); assert.equal(f.call("begin", [2]), 0);
  f.call("enableDischarging"); f.tick(); f.tick();
  assert.ok(f.runtime.states.load.readings!.current > 0.9);
  assert.equal(f.call("getBatteryVoltage"), 10800); assert.equal(f.call("getCellVoltage", [1]), 3600);
  f.call("setCellUndervoltageProtection", [3700, 0.1]); f.tick(1000); f.tick(1099); assert.equal(f.runtime.states.dut.status, "Monitoring");
  f.tick(1100); f.tick(1100); assert.equal(f.runtime.states.dut.status, "Protection active"); assert.ok(Math.abs(f.runtime.states.load.readings!.current) < 0.00001);
  assert.ok(f.runtime.drives.some(d => d.pin === "ALERT" && d.value === 1));
});

test("BQ76920 overvoltage, overcurrent, temperature, balancing, and five-cell stack affect outputs", () => {
  const overvoltage = bq769Fixture([90, 50, 50]); overvoltage.tick(); overvoltage.call("begin", [2]); overvoltage.call("enableDischarging");
  overvoltage.tick(1); overvoltage.call("setCellOvervoltageProtection", [3900, 0]); overvoltage.tick(2);
  assert.equal(overvoltage.runtime.states.dut.status, "Protection active");
  assert.ok(overvoltage.runtime.drives.some(d => d.pin === "ALERT" && d.value === 1));

  const overcurrent = bq769Fixture(); overcurrent.tick(); overcurrent.call("begin", [2]); overcurrent.call("enableDischarging"); overcurrent.tick(1); overcurrent.tick(2);
  overcurrent.call("setOvercurrentDischargeProtection", [500, 0]); overcurrent.tick(3); overcurrent.tick(4);
  assert.equal(overcurrent.runtime.states.dut.status, "Protection active", JSON.stringify(overcurrent.runtime.states.dut));
  assert.ok(Math.abs(overcurrent.runtime.states.load.readings!.current) < 0.00001);

  const hot = bq769Fixture([50, 50, 50], [55, 25, 25]); hot.tick(); hot.call("begin", [2]);
  hot.call("setTemperatureLimits", [0, 45, 0, 50]); hot.tick(1); hot.tick(101);
  assert.equal(hot.runtime.states.dut.status, "Protection active", JSON.stringify(hot.runtime.states.dut));

  const balancing = bq769Fixture([60, 50, 50], [25, 25, 25], false); balancing.tick(); balancing.call("begin", [2]);
  balancing.call("setBalancingThresholds", [1, 3400, 20]); balancing.call("enableAutoBalancing");
  balancing.tick(1); const before = balancing.runtime.states.cell0.readings!.soc;
  balancing.tick(60001); assert.equal(balancing.runtime.states.dut.readings!.balancing, 1);
  balancing.tick(61001); assert.ok(balancing.runtime.states.cell0.readings!.soc < before);

  const fiveCell = bq769Fixture([50, 50, 50, 50, 50]); fiveCell.tick();
  assert.equal(fiveCell.runtime.states.dut.status, "Monitoring"); fiveCell.call("begin", [2]); assert.equal(fiveCell.call("getBatteryVoltage"), 18000);
});


test("SPI chip-select boundaries restart commands without requiring a transaction wrapper", () => {
  const f = fixture("bmp280", "");
  f.wire("dut", "CSB", "uno", "D10"); f.wire("dut", "SDI", "uno", "D11"); f.wire("dut", "SDO", "uno", "D12"); f.wire("dut", "SCK", "uno", "D13");
  f.pins[10].mode = "OUTPUT"; f.pins[10].pwmValue = 0; f.tick();
  f.call("transfer", [0xd0], "SPI"); assert.equal(f.call("transfer", [0], "SPI"), 0x58);
  f.pins[10].pwmValue = 255; f.tick(); f.pins[10].pwmValue = 0; f.tick();
  f.call("transfer", [0xd0], "SPI"); assert.equal(f.call("transfer", [0], "SPI"), 0x58);
  f.project.connections = f.project.connections.filter(w => w.from.pin !== "SDI"); f.tick();
  assert.equal(f.call("transfer", [0], "SPI"), 255);
});

test("Wire buffer length controls writes and scalar bytes are not allocated as arrays", () => {
  const f = fixture("mcp23017", "byte scalar; byte data[3] = {20, 165, 90}; DeviceAddress address; Adafruit_MCP23X17 sensor;");
  assert.equal(f.runtime.values.has("scalar"), false); assert.equal((f.runtime.values.get("address") as number[]).length, 8);
  f.i2c(); f.rail("RESET"); ["A0", "A1", "A2"].forEach(pin => f.rail(pin, "GND")); f.tick();
  f.call("beginTransmission", [0x20], "Wire");
  assert.equal(f.runtime.invoke("Wire", "write", [[20, 165, 90], 2], Number), 2);
  f.call("endTransmission", [], "Wire");
  assert.equal(f.runtime.memory.get("dut")!.registers[20], 165);
  assert.equal(f.runtime.memory.get("dut")!.registers[21], 0);
  const sketch = compileArduinoSketch("#include <Wire.h>\nbyte data[3]={20,165,90}; void setup(){Wire.begin(); Wire.beginTransmission(32); Wire.write(data,2); Wire.endTransmission();} void loop(){}");
  assert.equal(sketch.valid, true, JSON.stringify(sketch.diagnostics));
});
