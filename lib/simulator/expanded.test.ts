import test from "node:test";
import assert from "node:assert/strict";
import { ArduinoSimulator, solveCircuit, compileArduinoSketch } from "./index.ts";
import { createDefaultBlinkProject, type CircuitProject } from "../circuit/index.ts";
import { BOARD_IDS, BOARD_PROFILES } from "../circuit/boards.ts";
import { COMPONENT_EXAMPLES } from "../circuit/component-examples.ts";

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

test("Serial reports changing runtime variables and both branches of string conditionals", () => {
  const simulator = new ArduinoSimulator(`
    int brightness = 64;
    bool stripOn = false;
    void setup() { Serial.begin(9600); }
    void loop() {
      brightness += 10;
      Serial.println(brightness);
      Serial.println(stripOn ? "ON" : "OFF");
      stripOn = !stripOn;
      Serial.println(stripOn ? "ON" : "OFF");
      delay(10);
    }
  `);

  assert.equal(simulator.getCompiledSketch().valid, true);
  simulator.run(); simulator.advance(0);
  assert.deepEqual(simulator.getSnapshot().serial.map(entry => entry.text), ["74", "OFF", "ON"]);
  simulator.advance(10);
  assert.deepEqual(simulator.getSnapshot().serial.slice(-3).map(entry => entry.text), ["84", "ON", "OFF"]);
});

test("generated-style KY-040 and NeoPixel sketch changes brightness and strip state", () => {
  const project = COMPONENT_EXAMPLES["ky-040"]();
  const stripExample = COMPONENT_EXAMPLES["ws2812b-strip-8"]();
  project.components.push(...stripExample.components.filter(component => component.id !== "uno").map(component => ({
    ...component,
    id: component.id === "device" ? "strip" : component.id,
  })));
  project.connections.push(...stripExample.connections.map(connection => ({
    ...connection,
    id: `strip-${connection.id}`,
    from: { ...connection.from, componentId: connection.from.componentId === "device" ? "strip" : connection.from.componentId },
    to: { ...connection.to, componentId: connection.to.componentId === "device" ? "strip" : connection.to.componentId },
  })));
  project.code = `
    #include <Encoder.h>
    #include <Adafruit_NeoPixel.h>
    Encoder myEnc(2, 3);
    Adafruit_NeoPixel strip(8, 6, NEO_GRB + NEO_KHZ800);
    long oldPosition = -999;
    int brightness = 64;
    bool stripOn = true;
    int lastButtonState = HIGH;
    int stableButtonState = HIGH;
    unsigned long lastDebounceTime = 0;
    unsigned long debounceDelay = 50;
    void setup() {
      Serial.begin(9600);
      pinMode(4, INPUT_PULLUP);
      strip.begin();
      strip.setBrightness(brightness);
      strip.show();
    }
    void loop() {
      long newPosition = myEnc.read();
      if (newPosition != oldPosition) {
        long diff = newPosition - oldPosition;
        if (oldPosition == -999) diff = 0;
        oldPosition = newPosition;
        if (diff != 0) {
          brightness = brightness + (diff > 0 ? 10 : -10);
          if (brightness > 240) brightness = 240;
          if (brightness < 16) brightness = 16;
          strip.setBrightness(brightness);
          Serial.print("Position: "); Serial.print(newPosition);
          Serial.print(" | Brightness: "); Serial.print(brightness);
          Serial.print(" | Strip: "); Serial.println(stripOn ? "ON" : "OFF");
        }
      }
      int reading = digitalRead(4);
      if (reading != lastButtonState) lastDebounceTime = millis();
      if ((millis() - lastDebounceTime) > debounceDelay) {
        if (reading != stableButtonState) {
          stableButtonState = reading;
          if (stableButtonState == LOW) {
            stripOn = !stripOn;
            Serial.print("Position: "); Serial.print(oldPosition == -999 ? 0 : oldPosition);
            Serial.print(" | Brightness: "); Serial.print(brightness);
            Serial.print(" | Strip: "); Serial.println(stripOn ? "ON" : "OFF");
          }
        }
      }
      lastButtonState = reading;
      if (stripOn) {
        for (int i = 0; i < strip.numPixels(); i++) strip.setPixelColor(i, strip.Color(255, 0, 0));
      } else {
        for (int i = 0; i < strip.numPixels(); i++) strip.setPixelColor(i, strip.Color(0, 0, 0));
      }
      strip.show();
      delay(10);
    }
  `;
  const simulator = new ArduinoSimulator(project.code);
  simulator.attachProject(project);
  assert.equal(simulator.getCompiledSketch().valid, true, JSON.stringify(simulator.getCompiledSketch().diagnostics));
  simulator.run(); simulator.advance(0);
  let snapshot = simulator.getSnapshot();
  assert.equal(snapshot.componentStates.strip.readings?.litPixels, 8, "the initially enabled strip visibly lights all eight pixels");
  assert.equal(snapshot.componentStates.strip.pixels?.[0]?.r, 64, "the configured starting brightness is applied");
  assert.equal(snapshot.diagnostics.some(diagnostic => diagnostic.severity === "error"), false);

  const turned = { ...project, components: project.components.map(component => component.id === "device" ? { ...component, properties: { ...component.properties, position: 5 } } : component) };
  simulator.attachProject(turned); simulator.advance(10);
  snapshot = simulator.getSnapshot();
  assert.ok(snapshot.serial.some(entry => entry.text === "5") && snapshot.serial.some(entry => entry.text === "74"), "the changed encoder position updates Serial and brightness");
  assert.equal(snapshot.componentStates.strip.pixels?.[0]?.r, 74, "the changed brightness reaches the visible pixel model");

  const pressed = { ...turned, components: turned.components.map(component => component.id === "device" ? { ...component, properties: { ...component.properties, pressed: true } } : component) };
  simulator.attachProject(pressed); simulator.advance(80);
  snapshot = simulator.getSnapshot();
  assert.ok(snapshot.serial.some(entry => entry.text === "OFF"), "a debounced press is visible in Serial");
  assert.equal(snapshot.componentStates.strip.readings?.litPixels, 0, "the first press turns every pixel off");
  assert.equal(snapshot.componentStates.strip.pixels?.[0]?.r, 0);

  const released = { ...pressed, components: pressed.components.map(component => component.id === "device" ? { ...component, properties: { ...component.properties, pressed: false } } : component) };
  simulator.attachProject(released); simulator.advance(80);
  assert.equal(simulator.getSnapshot().componentStates.strip.readings?.litPixels, 0, "releasing the switch does not create a second press");
  const pressedAgain = { ...released, components: released.components.map(component => component.id === "device" ? { ...component, properties: { ...component.properties, pressed: true } } : component) };
  simulator.attachProject(pressedAgain); simulator.advance(80);
  snapshot = simulator.getSnapshot();
  assert.ok(snapshot.serial.some(entry => entry.text === "ON"), "the second debounced press turns the strip back on");
  assert.equal(snapshot.componentStates.strip.readings?.litPixels, 8, "the loop and show() illuminate all eight pixels");
  assert.equal(snapshot.componentStates.strip.pixels?.[0]?.r, 74);
  assert.equal(snapshot.diagnostics.some(diagnostic => diagnostic.severity === "error"), false);
});

test("capacitive soil sensor changes wired ADC results on all published boards", () => {
  const analogPins: Record<string, string> = {
    "arduino-uno": "A0", "arduino-mega-2560": "A0", "arduino-nano-classic": "A0",
    "esp32-devkitc-v4": "GPIO34", "esp8266-nodemcu-v1": "A0", "raspberry-pi-pico": "GP26",
  };
  for (const boardType of BOARD_IDS) {
    const analogPin = analogPins[boardType];
    const project: CircuitProject = {
      ...createDefaultBlinkProject(), board: boardType as CircuitProject["board"], activeBoardId: "board",
      code: `void setup(){Serial.begin(9600);} void loop(){Serial.println(analogRead(${analogPin})); delay(100);}`,
      components: [
        { id: "board", type: boardType, label: boardType, x: 0, y: 0 },
        { id: "probe", type: "soil-moisture-sen0193", label: "Soil probe", x: 500, y: 0, properties: { moisture: 20 } },
      ],
      connections: [
        { id: "probe-vcc", from: { componentId: "probe", pin: "VCC" }, to: { componentId: "board", pin: "3V3" } },
        { id: "probe-gnd", from: { componentId: "probe", pin: "GND" }, to: { componentId: "board", pin: "GND" } },
        { id: "probe-out", from: { componentId: "probe", pin: "AOUT" }, to: { componentId: "board", pin: analogPin } },
      ],
    };
    const simulator = new ArduinoSimulator(project.code, { boardId: boardType, boardComponentId: "board" });
    simulator.attachProject(project);
    assert.equal(simulator.getCompiledSketch().valid, true, `${boardType} accepts its ADC pin`);
    simulator.run(); simulator.advance(0);
    const dry = Number(simulator.getSnapshot().serial.at(-1)?.text);
    const maxAdc = 2 ** BOARD_PROFILES[boardType].analogResolutionBits - 1;
    assert.equal(dry, Math.round(maxAdc * 0.8), `${boardType} reports its profile ADC resolution`);

    const wetter = { ...project, components: project.components.map(component => component.id === "probe" ? { ...component, properties: { moisture: 80 } } : component) };
    simulator.attachProject(wetter); simulator.advance(100);
    const wet = Number(simulator.getSnapshot().serial.at(-1)?.text);
    assert.ok(wet < dry, `${boardType}: wetter soil lowers the analog output`);

    const unplugged = { ...wetter, connections: wetter.connections.filter(connection => connection.id !== "probe-out") };
    simulator.attachProject(unplugged); simulator.run(); simulator.advance(100);
    assert.equal(Number(simulator.getSnapshot().serial.at(-1)?.text), 0, `${boardType}: disconnected analog output reads as zero`);

    const missingSupply = { ...project, connections: project.connections.filter(connection => connection.id !== "probe-vcc") };
    simulator.attachProject(missingSupply); simulator.run(); simulator.advance(100);
    assert.equal(simulator.getSnapshot().componentStates.probe.powered, false, `${boardType}: missing sensor power is visible`);
  }
});

test("BH1750 library and raw Wire transactions share powered, addressed sensor state", () => {
  const base = COMPONENT_EXAMPLES["bh1750-sen0097"]();
  const direct = { ...base, code: `#include <Wire.h>\nvoid setup(){ Serial.begin(9600); Wire.begin(); Wire.beginTransmission(0x23); Wire.write(0x10); Wire.endTransmission(); }\nvoid loop(){ delay(120); Wire.requestFrom(0x23,2); int highByte=Wire.read(); int lowByte=Wire.read(); Serial.println(highByte*256+lowByte); delay(1000); }` };
  const raw = new ArduinoSimulator(direct.code); raw.attachProject(direct); raw.run(); raw.advance(0); raw.advance(120);
  assert.equal(raw.getSnapshot().serial.at(-1)?.text, String(Math.round(485 * 1.2)), "Wire reads the sensor's two-byte count value");
  assert.equal(raw.getSnapshot().diagnostics.some(d => d.severity === "error"), false);

  const highAddress = { ...base,
    code: base.code.replace("BH1750 lightMeter;", "BH1750 lightMeter(0x5C);"),
    connections: base.connections.filter(w => w.id !== "wire-4"),
  };
  highAddress.connections.push({ id: "add-high", from: { componentId: "device", pin: "ADD" }, to: { componentId: "uno", pin: "3V3" } });
  const high = new ArduinoSimulator(highAddress.code); high.attachProject(highAddress); high.run(); high.advance(0); high.advance(120);
  assert.ok(high.getSnapshot().serial.some(entry => entry.text === "485"), "ADD high responds at the explicitly selected 0x5C address");

  const wrongAddress = { ...base, code: base.code.replace("BH1750 lightMeter;", "BH1750 lightMeter(0x5C);") };
  const absent = new ArduinoSimulator(wrongAddress.code); absent.attachProject(wrongAddress); absent.run(); absent.advance(0);
  assert.ok(absent.getSnapshot().diagnostics.some(d => d.code === "DEVICE_NOT_CONNECTED"), "the wrong strapped address does not acknowledge");

  const disconnected = { ...base, connections: base.connections.filter(w => w.to.pin !== "A4") };
  const noBus = new ArduinoSimulator(disconnected.code); noBus.attachProject(disconnected); noBus.run(); noBus.advance(0);
  assert.ok(noBus.getSnapshot().diagnostics.some(d => d.code === "DEVICE_NOT_CONNECTED"), "a broken SDA wire prevents initialization");
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
