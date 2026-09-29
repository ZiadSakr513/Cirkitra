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
  const board = project.components.find(component => component.type === project.board);
  const simulator = new ArduinoSimulator(project.code, { boardId: project.board, ...(board ? { boardComponentId: board.id } : {}) }); simulator.attachProject(project);
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
  } else if (fixture === "soil-probe-changes-board-adc") {
    simulator.advance(0);
    const dry = Number(simulator.getSnapshot().serial.at(-1)?.text);
    assert.equal(simulator.getSnapshot().componentStates.device.readings?.moisture, 35);
    assert.ok(dry > 600 && dry < 800, `dry soil produces a higher analogRead value, got ${dry}`);
    const wet = { ...project, components: project.components.map(c => c.id === "device" ? { ...c, properties: { moisture: 90 } } : c) };
    simulator.attachProject(wet); simulator.advance(250);
    const wetValue = Number(simulator.getSnapshot().serial.at(-1)?.text);
    assert.ok(wetValue < dry, `increasing moisture lowers the simulated probe output (${wetValue} < ${dry})`);
  } else if (fixture === "bh1750-reports-wired-lux") {
    simulator.advance(120);
    const light = simulator.getSnapshot().componentStates.device;
    assert.equal(light.status, "Ready");
    assert.equal(light.readings?.lux, 485);
    assert.ok(simulator.getSnapshot().serial.some(entry => entry.text === "485"), "the linked BH1750 library reads the wired sensor input");
    const brighter = { ...project, components: project.components.map(c => c.id === "device" ? { ...c, properties: { lux: 1234 } } : c) };
    simulator.attachProject(brighter); simulator.advance(1000);
    assert.ok(simulator.getSnapshot().serial.some(entry => entry.text === "1234"), "a brighter scene changes the next sensor reading");
    assert.equal(simulator.getSnapshot().diagnostics.some(d => d.severity === "error"), false);
  } else if (fixture === "ssd1306-sketch-updates-screen-buffer") {
    const display = simulator.getSnapshot().componentStates.device;
    assert.equal(display.status, "Displaying");
    assert.match(display.display?.[0] ?? "", /Cirkitra ready/);
    assert.match(display.display?.[1] ?? "", /128x64 OLED/);
    const changed = { ...project, code: project.code.replace("Cirkitra ready", "Boards first") };
    const updatedSketch = new ArduinoSimulator(changed.code); updatedSketch.attachProject(changed); updatedSketch.run(); updatedSketch.advance(0);
    assert.match(updatedSketch.getSnapshot().componentStates.device.display?.[0] ?? "", /Boards first/, "the running sketch controls the visible OLED text");
    const disconnected = { ...project, connections: project.connections.filter(w => w.to.pin !== "A4") };
    const noSda = new ArduinoSimulator(disconnected.code); noSda.attachProject(disconnected); noSda.run(); noSda.advance(0);
    assert.ok(noSda.getSnapshot().diagnostics.some(d => d.code === "DEVICE_NOT_CONNECTED"), "missing SDA prevents OLED initialization");
  } else if (fixture === "ws2812b-individual-pixels-update-on-show") {
    const strip = simulator.getSnapshot().componentStates.device;
    assert.equal(strip.status, "Displaying");
    assert.equal(strip.pixels?.length, 8);
    assert.deepEqual(strip.pixels?.slice(0, 3), [{ r: 96, g: 0, b: 0 }, { r: 0, g: 96, b: 0 }, { r: 0, g: 0, b: 96 }]);
    assert.equal(strip.readings?.litPixels, 3);
    const disconnected = { ...project, connections: project.connections.filter(w => !(w.from.componentId === "device" && w.from.pin === "DIN")) };
    const noData = new ArduinoSimulator(disconnected.code); noData.attachProject(disconnected); noData.run(); noData.advance(0);
    assert.ok(noData.getSnapshot().diagnostics.some(d => d.code === "NEOPIXEL_NOT_CONNECTED"), "missing data pin prevents strip initialization");
    const changedCode = project.code.replace("strip.Color(255,0,0)", "strip.Color(0,255,255)");
    const changed = { ...project, code: changedCode };
    const rerun = new ArduinoSimulator(changed.code); rerun.attachProject(changed); rerun.run(); rerun.advance(0);
    assert.deepEqual(rerun.getSnapshot().componentStates.device.pixels?.[0], { r: 0, g: 96, b: 96 }, "sketch color updates the individual simulated pixel");
    const lowVoltageBoard = { ...project, board: "esp32-devkitc-v4" as const, code: project.code.replaceAll("LED_PIN 6", "LED_PIN 18"), components: project.components.map(component => component.id === "uno" ? { ...component, type: "esp32-devkitc-v4" } : component), connections: project.connections.map(wire => wire.from.componentId === "device" && wire.from.pin === "DIN" ? { ...wire, to: { ...wire.to, pin: "GPIO18" } } : wire) };
    const esp = new ArduinoSimulator(lowVoltageBoard.code, { boardId: lowVoltageBoard.board, boardComponentId: "uno" }); esp.attachProject(lowVoltageBoard); esp.run(); esp.advance(0);
    assert.ok(esp.getSnapshot().diagnostics.some(diagnostic => diagnostic.code === "NEOPIXEL_LOGIC_LEVEL"), "3.3V MCU output cannot be treated as a valid high at a 5V WS2812B DIN");
  } else if (fixture === "ky040-encoder-and-button-follow-live-inputs") {
    simulator.advance(0);
    assert.equal(simulator.getSnapshot().componentStates.device.readings?.position, 3);
    assert.ok(simulator.getSnapshot().serial.some(entry => entry.text === "3"), "Encoder.read() returns the current interactive position");
    assert.ok(simulator.getSnapshot().serial.some(entry => entry.text === "1"), "an unpressed module button reads high through its pull-up");
    const changed = { ...project, components: project.components.map(component => component.id === "device" ? { ...component, properties: { position: 7, pressed: true } } : component) };
    simulator.attachProject(changed); simulator.advance(50);
    assert.equal(simulator.getSnapshot().componentStates.device.readings?.position, 7);
    assert.equal(simulator.getSnapshot().componentStates.device.readings?.buttonPressed, 1);
    assert.equal(simulator.getSnapshot().serial.at(-2)?.text, "7");
    assert.equal(simulator.getSnapshot().serial.at(-1)?.text, "0", "the integrated switch is active low when pressed");
    const apiProject = { ...project, code: project.code.replace("Serial.println(knob.read());", "Serial.println(knob.read()); knob.write(10); Serial.println(knob.read()); Serial.println(knob.readAndReset()); Serial.println(knob.read());") };
    const apiSimulator = new ArduinoSimulator(apiProject.code); apiSimulator.attachProject(apiProject); apiSimulator.run(); apiSimulator.advance(0);
    assert.deepEqual(apiSimulator.getSnapshot().serial.slice(0, 4).map(entry => entry.text), ["3", "10", "10", "0"], "write() sets the logical origin and readAndReset() returns then clears its count");
    const disconnected = { ...project, connections: project.connections.filter(wire => !(wire.from.componentId === "device" && wire.from.pin === "DT")) };
    const invalid = new ArduinoSimulator(disconnected.code); invalid.attachProject(disconnected); invalid.run(); invalid.advance(0);
    assert.ok(invalid.getSnapshot().diagnostics.some(diagnostic => diagnostic.code === "ENCODER_NOT_CONNECTED"), "a missing quadrature signal cannot report a valid encoder read");
    const unpowered = { ...project, connections: project.connections.filter(wire => !(wire.from.componentId === "device" && wire.from.pin === "VCC")) };
    const noPower = new ArduinoSimulator(unpowered.code); noPower.attachProject(unpowered); noPower.run(); noPower.advance(0);
    assert.equal(noPower.getSnapshot().componentStates.device.powered, false, "an unpowered encoder does not publish readings");
  } else if (fixture === "keypad-row-column-and-key-input-follow-sketch") {
    simulator.advance(0);
    assert.equal(simulator.getSnapshot().componentStates.device.status, "Key 5 pressed");
    assert.equal(simulator.getSnapshot().componentStates.device.readings?.row, 2);
    assert.equal(simulator.getSnapshot().componentStates.device.readings?.column, 2);
    assert.ok(simulator.getSnapshot().serial.some(entry => entry.text === "53"), "getKey() returns the pressed key as the char's numeric value in the interpreter");
    const direct = { ...project, code: "void setup(){ pinMode(8,OUTPUT); digitalWrite(8,LOW); pinMode(4,INPUT_PULLUP); Serial.begin(9600); } void loop(){ Serial.println(digitalRead(4)); delay(20); }" };
    const matrixScan = new ArduinoSimulator(direct.code); matrixScan.attachProject(direct); matrixScan.run(); matrixScan.advance(0);
    assert.equal(matrixScan.getSnapshot().serial[0]?.text, "0", "the pressed R2/C2 switch closes the actual wired matrix path");
    const otherKey = { ...direct, components: direct.components.map(component => component.id === "device" ? { ...component, properties: { key: "1" } } : component) };
    matrixScan.attachProject(otherKey); matrixScan.advance(20);
    assert.equal(matrixScan.getSnapshot().serial.at(-1)?.text, "1", "a different key leaves the unselected column pulled high");
    const unconnected = { ...project, connections: project.connections.filter(wire => !(wire.from.componentId === "device" && wire.from.pin === "C4")) };
    const invalid = new ArduinoSimulator(unconnected.code); invalid.attachProject(unconnected); invalid.run(); invalid.advance(0);
    assert.ok(invalid.getSnapshot().diagnostics.some(diagnostic => diagnostic.code === "KEYPAD_NOT_CONNECTED"), "missing matrix rows or columns block library input");
  } else if (fixture === "relay-active-low-switches-wired-contact-load") {
    simulator.advance(0);
    assert.equal(simulator.getSnapshot().componentStates.device.status, "Energized · COM–NO");
    assert.equal(solveCircuit(project, simulator.getSnapshot()).componentStates.led.powered, true, "an active-low input closes COM–NO and powers the wired load");
    simulator.advance(500);
    assert.equal(simulator.getSnapshot().componentStates.device.status, "Released · COM–NC");
    assert.equal(solveCircuit(project, simulator.getSnapshot()).componentStates.led.powered, false, "an input HIGH switches away from NO");
    simulator.advance(500);
    assert.equal(solveCircuit(project, simulator.getSnapshot()).componentStates.led.powered, true, "the contact responds again when IN returns LOW");
    const floating = { ...project, connections: project.connections.filter(wire => !(wire.from.componentId === "device" && wire.from.pin === "IN")) };
    const noControl = new ArduinoSimulator(floating.code); noControl.attachProject(floating); noControl.run(); noControl.advance(0);
    assert.equal(noControl.getSnapshot().componentStates.device.status, "Control floating");
    const unpowered = { ...project, connections: project.connections.filter(wire => !(wire.from.componentId === "device" && wire.from.pin === "VCC")) };
    const noPower = new ArduinoSimulator(unpowered.code); noPower.attachProject(unpowered); noPower.run(); noPower.advance(0);
    assert.equal(noPower.getSnapshot().componentStates.device.status, "Unpowered");
  } else if (fixture === "ds3231-wire-registers-follow-simulated-time") {
    simulator.advance(0);
    const initial = simulator.getSnapshot().componentStates.device;
    assert.equal(initial.status, "Running");
    assert.deepEqual([initial.readings?.year, initial.readings?.month, initial.readings?.day, initial.readings?.hour, initial.readings?.minute, initial.readings?.second], [2026, 8, 24, 14, 35, 57]);
    assert.ok(simulator.getSnapshot().serial.some(entry => entry.text === "87"), "Wire reads the DS3231 seconds register in BCD");
    simulator.advance(3000);
    const advanced = simulator.getSnapshot().componentStates.device;
    assert.deepEqual([advanced.readings?.hour, advanced.readings?.minute, advanced.readings?.second], [14, 36, 0], "the RTC follows simulated time, not wall time");
    const setClock = { ...project, code: project.code.replace("void setup(){ Serial.begin(9600); Wire.begin(); }", "void setup(){ Serial.begin(9600); Wire.begin(); Wire.beginTransmission(0x68); Wire.write(0); Wire.write(0x12); Wire.endTransmission(); }") };
    const setSimulator = new ArduinoSimulator(setClock.code); setSimulator.attachProject(setClock); setSimulator.run(); setSimulator.advance(0);
    assert.equal(setSimulator.getSnapshot().componentStates.device.readings?.second, 12, "writing BCD 0x12 sets the seconds register");
    assert.equal(setSimulator.getSnapshot().serial[0]?.text, "18", "the sketch reads back the value it wrote");
    setSimulator.advance(2000);
    assert.equal(setSimulator.getSnapshot().componentStates.device.readings?.second, 14, "the written time continues to advance from the simulator clock");
    const disconnected = { ...project, connections: project.connections.filter(wire => !(wire.from.componentId === "device" && wire.from.pin === "SDA")) };
    const noBus = new ArduinoSimulator(disconnected.code); noBus.attachProject(disconnected); noBus.run(); noBus.advance(0);
    assert.equal(noBus.getSnapshot().componentStates.device.status, "I2C disconnected");
    assert.ok(noBus.getSnapshot().diagnostics.some(diagnostic => diagnostic.code === "I2C_DEVICE_NOT_CONNECTED"), "missing SDA is an actionable transaction failure");
    const unpowered = { ...project, connections: project.connections.filter(wire => !(wire.from.componentId === "device" && wire.from.pin === "VCC")) };
    const noPower = new ArduinoSimulator(unpowered.code); noPower.attachProject(unpowered); noPower.run(); noPower.advance(0);
    assert.equal(noPower.getSnapshot().componentStates.device.status, "Unpowered");
  } else if (fixture === "sd-library-stores-and-reads-card-file") {
    simulator.advance(0);
    assert.equal(simulator.getSnapshot().componentStates.device.status, "Mounted");
    assert.equal(simulator.getSnapshot().componentStates.device.readings?.files, 1);
    assert.ok((simulator.getSnapshot().componentStates.device.readings?.storedBytes ?? 0) > 0, "File.println() stores bytes on the virtual card");
    assert.equal(simulator.getSnapshot().serial[0]?.text, "67", JSON.stringify({ serial: simulator.getSnapshot().serial, diagnostics: simulator.getSnapshot().diagnostics, state: simulator.getSnapshot().componentStates.device }));
    const disconnected = { ...project, connections: project.connections.filter(wire => !(wire.from.componentId === "device" && wire.from.pin === "CS")) };
    const noCs = new ArduinoSimulator(disconnected.code); noCs.attachProject(disconnected); noCs.run(); noCs.advance(0);
    assert.ok(noCs.getSnapshot().diagnostics.some(diagnostic => diagnostic.code === "SD_NOT_CONNECTED"), "a missing chip-select wire prevents SD.begin");
    const absent = { ...project, components: project.components.map(component => component.id === "device" ? { ...component, properties: { ...component.properties, cardPresent: false } } : component) };
    const noCard = new ArduinoSimulator(absent.code); noCard.attachProject(absent); noCard.run(); noCard.advance(0);
    assert.equal(noCard.getSnapshot().componentStates.device.status, "No card");
  } else if (fixture === "wired-mfrc522-reads-interactive-tag-uid") {
    simulator.advance(0);
    assert.equal(simulator.getSnapshot().componentStates.device.status, "Tag DEADBEEF");
    assert.equal(simulator.getSnapshot().componentStates.device.readings?.uidLength, 4);
    assert.ok(simulator.getSnapshot().serial.some(entry => entry.text === "222"), "the sketch reads UID byte 0xDE from the interactive tag");
    const changed = { ...project, components: project.components.map(component => component.id === "device" ? { ...component, properties: { ...component.properties, tagUid: "01020304050607" } } : component) };
    simulator.attachProject(changed); simulator.advance(100);
    assert.equal(simulator.getSnapshot().componentStates.device.readings?.uidLength, 7);
    assert.ok(simulator.getSnapshot().serial.some(entry => entry.text === "1"), "a different seven-byte virtual tag changes the sketch readback");
    const disconnected = { ...project, connections: project.connections.filter(wire => !(wire.from.componentId === "device" && wire.from.pin === "SCK")) };
    const noClock = new ArduinoSimulator(disconnected.code); noClock.attachProject(disconnected); noClock.run(); noClock.advance(0);
    assert.ok(noClock.getSnapshot().diagnostics.some(diagnostic => diagnostic.code === "RFID_NOT_CONNECTED"), "a missing SPI clock prevents initialization and tag reads");
    const noTag = { ...project, components: project.components.map(component => component.id === "device" ? { ...component, properties: { ...component.properties, tagPresent: false } } : component) };
    const emptyReader = new ArduinoSimulator(noTag.code); emptyReader.attachProject(noTag); emptyReader.run(); emptyReader.advance(0);
    assert.equal(emptyReader.getSnapshot().serial.length, 0, "no tag present produces no successful UID read");
  } else if (fixture === "a4988-step-pulses-drive-wired-stepper") {
    simulator.advance(500);
    const motor = simulator.getSnapshot().componentStates.motor;
    assert.equal(motor.direction, "forward");
    assert.ok(Math.abs(motor.readings?.steps ?? 0) >= 5, "rising STEP pulses advance the wired motor position");
    assert.ok((motor.readings?.rpm ?? 0) > 0, "simulated step interval controls displayed RPM");
    const reverse = { ...project, code: project.code.replace("digitalWrite(3,HIGH)", "digitalWrite(3,LOW)") };
    const reverseSimulator = new ArduinoSimulator(reverse.code); reverseSimulator.attachProject(reverse); reverseSimulator.run(); reverseSimulator.advance(500);
    assert.equal(reverseSimulator.getSnapshot().componentStates.motor.direction, "reverse");
    const halfStep = { ...project, connections: [...project.connections, { id: "ms1-half-step", from: { componentId: "device", pin: "MS1" }, to: { componentId: "uno", pin: "5V" } }] };
    const halfStepSimulator = new ArduinoSimulator(halfStep.code); halfStepSimulator.attachProject(halfStep); halfStepSimulator.run(); halfStepSimulator.advance(100);
    assert.equal(halfStepSimulator.getSnapshot().componentStates.device.readings?.microstep, 2, "the wired MS1 selector changes the driver to half-step mode");
    assert.ok((halfStepSimulator.getSnapshot().componentStates.motor.readings?.angleDegrees ?? 0) > 0, "half-step pulses advance the visible rotor");
    const disabled = { ...project, code: project.code.replace("digitalWrite(4,LOW)", "digitalWrite(4,HIGH)") };
    const disabledSimulator = new ArduinoSimulator(disabled.code); disabledSimulator.attachProject(disabled); disabledSimulator.run(); disabledSimulator.advance(500);
    assert.equal(disabledSimulator.getSnapshot().componentStates.motor.readings?.steps, 0, "active-high EN disables the carrier outputs");
    const unpowered = { ...project, connections: project.connections.filter(wire => !(wire.from.componentId === "device" && wire.from.pin === "VMOT")) };
    const noMotorPower = new ArduinoSimulator(unpowered.code); noMotorPower.attachProject(unpowered); noMotorPower.run(); noMotorPower.advance(500);
    assert.equal(noMotorPower.getSnapshot().componentStates.motor.readings?.steps, 0, "missing motor supply cannot move the stepper");
    assert.ok(noMotorPower.getSnapshot().diagnostics.some(diagnostic => diagnostic.code === "A4988_SUPPLY"));
    const competingDriver = {
      ...project,
      components: [...project.components, { ...project.components.find(component => component.id === "device")!, id: "device-2", label: "Second A4988" }],
      connections: [...project.connections, ...project.connections.filter(wire =>
        (wire.from.componentId === "device" && ["1A", "1B", "2A", "2B"].includes(wire.from.pin))
        || (wire.to.componentId === "device" && ["1A", "1B", "2A", "2B"].includes(wire.to.pin))
      ).map(wire => ({ ...wire,
        from: wire.from.componentId === "device" ? { ...wire.from, componentId: "device-2" } : wire.from,
        to: wire.to.componentId === "device" ? { ...wire.to, componentId: "device-2" } : wire.to,
      }))],
    };
    const contention = new ArduinoSimulator(competingDriver.code); contention.attachProject(competingDriver); contention.run(); contention.advance(500);
    assert.equal(contention.getSnapshot().componentStates.device.status, "Driver output conflict", "two carriers cannot silently drive the same coils");
    assert.ok(contention.getSnapshot().diagnostics.some(diagnostic => diagnostic.code === "A4988_OUTPUT_CONTENTION"));
    assert.equal(contention.getSnapshot().componentStates.motor.readings?.steps, 0, "conflicting bridges do not report motor movement");
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
  } else if (fixture === "board-profile-gpio-blink") {
    assert.equal(initial.componentStates.device.powered, true, `${id} board output drives its wired indicator`);
    assert.equal(simulator.getSnapshot().boardPins?.[board!.id]?.some(pin => pin.mode === "OUTPUT" && pin.digitalValue === 1), true);
    simulator.advance(500);
    assert.equal(solveCircuit(project, simulator.getSnapshot()).componentStates.device.powered, false, `${id} output toggles low on simulated time`);
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
