import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultBlinkProject } from "../circuit/default-project.ts";
import { resolveComponentBoardPinEndpoints, solveCircuit } from "./circuit-state.ts";
import { createInitialPinStates } from "./pins.ts";
import { ArduinoSimulator } from "./engine.ts";
import { MultiBoardSimulator } from "./multi-board.ts";
import { activateBoardProgram, getBoardProgram, updateActiveBoardProgram } from "../circuit/board-programs.ts";
import { getComponentDefinition } from "../circuit/catalog.ts";
import { boardPinLabel } from "../circuit/boards.ts";
import { DeviceRuntime } from "./devices.ts";
import { DeviceWiring } from "./device-wiring.ts";
import type { CircuitProject } from "../circuit/types.ts";
import { compileArduinoSketch } from "./parser.ts";
import { COMPONENT_EXAMPLES } from "../circuit/component-examples.ts";

function mixedBoardProject(): CircuitProject {
  return {
    ...createDefaultBlinkProject(),
    board: "arduino-mega-2560",
    activeBoardId: "mega",
    components: [
      { id: "mega", type: "arduino-mega-2560", label: "Mega", x: 0, y: 0 },
      { id: "esp", type: "esp32-devkitc-v4", label: "ESP32", x: 400, y: 0 },
      { id: "resistor", type: "resistor", label: "220 Ω", x: 700, y: 0, properties: { resistance: 220 } },
      { id: "led", type: "led", label: "Indicator", x: 900, y: 0 },
    ],
    connections: [
      { id: "signal", from: { componentId: "mega", pin: "D13" }, to: { componentId: "resistor", pin: "1" } },
      { id: "series", from: { componentId: "resistor", pin: "2" }, to: { componentId: "led", pin: "A" } },
      { id: "return", from: { componentId: "led", pin: "K" }, to: { componentId: "mega", pin: "GND" } },
    ],
  };
}

test("mixed-board circuit solving keeps identically named GPIOs isolated by board identity", () => {
  const project = mixedBoardProject();
  const endpoints = resolveComponentBoardPinEndpoints(project, "resistor", "1");
  assert.deepEqual(endpoints.map(item => [item.componentId, item.boardId, item.pin]), [["mega", "arduino-mega-2560", "D13"]]);
  const megaPins = createInitialPinStates("arduino-mega-2560").map(pin => pin.number === 13 ? { ...pin, mode: "OUTPUT" as const, digitalValue: 1 as const, pwmValue: 255 } : pin);
  const espPins = createInitialPinStates("esp32-devkitc-v4").map(pin => pin.number === 13 ? { ...pin, mode: "OUTPUT" as const, digitalValue: 0 as const, pwmValue: 0 } : pin);
  const snapshot = { ...new ArduinoSimulator("", { boardId: project.board, boardComponentId: "mega" }).getSnapshot(), boardPins: { mega: megaPins, esp: espPins }, primaryBoardId: "mega", primaryBoardType: project.board };
  assert.equal(solveCircuit(project, snapshot).componentStates.led.powered, true);
  const reversed = { ...snapshot, boardPins: { ...snapshot.boardPins, mega: megaPins.map(pin => pin.number === 13 ? { ...pin, digitalValue: 0 as const, pwmValue: 0 } : pin), esp: espPins.map(pin => pin.number === 13 ? { ...pin, digitalValue: 1 as const, pwmValue: 255 } : pin) } };
  assert.equal(solveCircuit(project, reversed).componentStates.led.powered, false);
});

test("board sketches persist independently while legacy `code` follows the selected board", () => {
  const project = mixedBoardProject();
  const mega = updateActiveBoardProgram(project, "void setup(){pinMode(13,OUTPUT);} void loop(){digitalWrite(13,HIGH);}");
  const esp = activateBoardProgram(mega, "esp");
  const editedEsp = updateActiveBoardProgram(esp, "void setup(){pinMode(4,OUTPUT);} void loop(){digitalWrite(4,LOW);}");
  const backToMega = activateBoardProgram(editedEsp, "mega");
  assert.equal(backToMega.board, "arduino-mega-2560");
  assert.match(backToMega.code, /digitalWrite\(13,HIGH\)/);
  assert.match(getBoardProgram(backToMega, "esp"), /digitalWrite\(4,LOW\)/);
  assert.match(getBoardProgram(backToMega, "mega"), /digitalWrite\(13,HIGH\)/);
});

test("multiple placed boards run separate sketches and resolve a wired digital signal", () => {
  const megaCode = "void setup(){ pinMode(13, OUTPUT); } void loop(){ digitalWrite(13, HIGH); Serial.println(1); delay(100); }";
  const espCode = "void setup(){ pinMode(4, INPUT); } void loop(){ Serial.println(2); delay(100); }";
  const project: CircuitProject = {
    ...mixedBoardProject(),
    code: megaCode,
    programs: { mega: megaCode, esp: espCode },
    connections: [
      ...mixedBoardProject().connections,
      { id: "board-link", from: { componentId: "mega", pin: "D13" }, to: { componentId: "esp", pin: "GPIO4" } },
    ],
  };
  const simulator = new MultiBoardSimulator();
  simulator.attachProject(project);
  simulator.run();
  simulator.advance(0);
  const snapshot = simulator.getSnapshot();
  assert.equal(snapshot.status, "running");
  assert.equal(snapshot.boardPins?.mega?.[13]?.digitalValue, 1);
  assert.equal(snapshot.boardPins?.esp?.[13]?.digitalValue, 0);
  assert.equal(snapshot.boardPins?.esp?.[4]?.digitalValue, 1);
  assert.equal(snapshot.boardSerial?.mega?.at(-1)?.text, "1");
  assert.equal(snapshot.boardSerial?.esp?.at(-1)?.text, "2");
  assert.equal(snapshot.boardSnapshots?.mega?.status, "running");
  assert.equal(snapshot.boardSnapshots?.esp?.status, "running");

  simulator.pause();
  const pausedTimes = [simulator.getSnapshot().boardSnapshots?.mega?.timeMs, simulator.getSnapshot().boardSnapshots?.esp?.timeMs];
  simulator.advance(500);
  assert.deepEqual([simulator.getSnapshot().boardSnapshots?.mega?.timeMs, simulator.getSnapshot().boardSnapshots?.esp?.timeMs], pausedTimes);
  simulator.selectBoard("esp");
  assert.match(simulator.getSource(), /Serial\.println\(2\)/);
  simulator.run();
  simulator.advance(100);
  const megaTime = simulator.getSnapshot().boardSnapshots?.mega?.timeMs;
  const espTime = simulator.getSnapshot().boardSnapshots?.esp?.timeMs;
  assert.ok(megaTime !== undefined && pausedTimes[0] !== undefined && megaTime > pausedTimes[0]);
  assert.ok(espTime !== undefined && pausedTimes[1] !== undefined && espTime > pausedTimes[1]);
  simulator.pause();
  simulator.step();
  assert.equal(simulator.getSnapshot().status, "paused");
  simulator.reset();
  assert.equal(simulator.getSnapshot().timeMs, 0);
  assert.equal(simulator.getSnapshot().boardSnapshots?.mega?.timeMs, 0);
  assert.equal(simulator.getSnapshot().boardSnapshots?.esp?.timeMs, 0);
  assert.equal(simulator.getSnapshot().boardPins?.mega?.[13]?.mode, "INPUT");
  assert.equal(simulator.getSnapshot().boardPins?.esp?.[4]?.mode, "INPUT");
});

test("hardware UART delivers bytes only across connected RX/TX pins at a matching baud", () => {
  const sender = "void setup(){ Serial1.begin(9600); } void loop(){ Serial1.println(\"A\"); delay(100); }";
  const receiver = "void setup(){ Serial1.begin(9600); } void loop(){ if(Serial1.available()){ int value=Serial1.read(); Serial.println(value); } delay(10); }";
  const project: CircuitProject = {
    ...mixedBoardProject(),
    code: sender,
    programs: { mega: sender, esp: receiver },
    connections: [
      { id: "mega-tx-to-esp-rx", from: { componentId: "mega", pin: "D18" }, to: { componentId: "esp", pin: "GPIO16" } },
      { id: "esp-tx-to-mega-rx", from: { componentId: "esp", pin: "GPIO17" }, to: { componentId: "mega", pin: "D19" } },
      { id: "shared-ground", from: { componentId: "mega", pin: "GND2" }, to: { componentId: "esp", pin: "GND2" } },
    ],
  };
  const connected = new MultiBoardSimulator(); connected.attachProject(project); connected.run(); connected.advance(0); connected.advance(100);
  assert.ok(connected.getSnapshot().boardSerial?.esp?.some(entry => entry.text === "65"));

  const disconnectedProject = structuredClone(project);
  disconnectedProject.connections = disconnectedProject.connections.filter(connection => connection.id !== "mega-tx-to-esp-rx");
  const disconnected = new MultiBoardSimulator(); disconnected.attachProject(disconnectedProject); disconnected.run(); disconnected.advance(0); disconnected.advance(500);
  assert.equal(disconnected.getSnapshot().boardSerial?.esp?.some(entry => entry.text === "65"), false);
  assert.ok(disconnected.getSnapshot().diagnostics.some(diagnostic => diagnostic.code === "UART_RECEIVER_DISCONNECTED"), "transmitted bytes with a missing RX wire produce an actionable warning");

  const wrongBaudProject = structuredClone(project);
  wrongBaudProject.programs!.esp = "void setup(){ Serial1.begin(19200); } void loop(){ if(Serial1.available()){ Serial.println(Serial1.read()); } delay(10); }";
  const wrongBaud = new MultiBoardSimulator(); wrongBaud.attachProject(wrongBaudProject); wrongBaud.run(); wrongBaud.advance(0); wrongBaud.advance(500);
  assert.equal(wrongBaud.getSnapshot().boardSerial?.esp?.some(entry => entry.text === "65"), false);
  assert.ok(wrongBaud.getSnapshot().diagnostics.some(diagnostic => diagnostic.code === "UART_RECEIVER_NOT_READY"), "a receiver with a mismatched baud reports why bytes were dropped");
});

test("generated Mega and ESP32 UART echo sketches exchange A and B over crossed wires", () => {
  const mega = `void setup() {
  Serial.begin(9600);
  Serial1.begin(9600);
}
void loop() {
  Serial1.write('A');
  Serial.println("Sent A");
  delay(1000);
  if (Serial1.available() > 0) {
    int incoming = Serial1.read();
    Serial.print("Mega received: ");
    Serial.println(incoming);
  }
  delay(1000);
}`;
  const esp = `void setup() {
  Serial.begin(9600);
  Serial1.begin(9600);
}
void loop() {
  if (Serial1.available() > 0) {
    int incoming = Serial1.read();
    Serial.print("ESP32 received numeric: ");
    Serial.println(incoming);
    Serial1.write('B');
  }
  delay(100);
}`;
  const project: CircuitProject = {
    ...mixedBoardProject(),
    code: mega,
    programs: { mega, esp },
    connections: [
      { id: "mega-tx-to-esp-rx", from: { componentId: "mega", pin: "D18" }, to: { componentId: "esp", pin: "GPIO16" } },
      { id: "esp-tx-to-mega-rx", from: { componentId: "esp", pin: "GPIO17" }, to: { componentId: "mega", pin: "D19" } },
      { id: "shared-ground", from: { componentId: "mega", pin: "GND2" }, to: { componentId: "esp", pin: "GND2" } },
    ],
  };
  const simulator = new MultiBoardSimulator();
  simulator.attachProject(project);
  simulator.run();
  for (let elapsed = 0; elapsed <= 2500; elapsed += 16.67) simulator.advance(16.67);
  const connected = simulator.getSnapshot();
  assert.ok(connected.boardSerial?.mega?.some(entry => entry.text === "Sent A"));
  assert.ok(connected.boardSerial?.esp?.some(entry => entry.text === "65"), "ESP32 logs ASCII A as 65");
  assert.ok(connected.boardSerial?.mega?.some(entry => entry.text === "66"), `Mega logs ASCII B as 66: ${JSON.stringify({ serial: connected.boardSerial, diagnostics: connected.diagnostics, boards: connected.boardSnapshots })}`);
  assert.equal(connected.diagnostics.some(item => item.code.startsWith("UART_")), false, JSON.stringify(connected.diagnostics));

  simulator.selectBoard("esp");
  const whileRunning = simulator.getSnapshot();
  assert.equal(whileRunning.status, "running", "changing the inspected board does not stop its peer");
  assert.ok(whileRunning.boardSerial?.esp?.some(entry => entry.text === "65"), "selecting another sketch retains the receiver output");

  const disconnectedProject = structuredClone(project);
  disconnectedProject.connections = disconnectedProject.connections.filter(item => item.id !== "mega-tx-to-esp-rx");
  const disconnected = new MultiBoardSimulator();
  disconnected.attachProject(disconnectedProject);
  disconnected.run();
  for (let elapsed = 0; elapsed <= 2500; elapsed += 16.67) disconnected.advance(16.67);
  assert.equal(disconnected.getSnapshot().boardSerial?.esp?.some(entry => entry.text === "65"), false);
  assert.ok(disconnected.getSnapshot().diagnostics.some(item => item.code === "UART_RECEIVER_DISCONNECTED"));
});

test("a device's bound board owns its visual state in a mixed-board circuit", () => {
  const project = COMPONENT_EXAMPLES["ws2812b-strip-8"]();
  project.activeBoardId = "uno";
  project.components.push({ id: "mega", type: "arduino-mega-2560", label: "Unrelated Mega", x: 1200, y: 0 });
  project.connections.push({ id: "shared-ground", from: { componentId: "uno", pin: "GND" }, to: { componentId: "mega", pin: "GND" } });
  project.programs = { uno: project.code, mega: "void setup(){} void loop(){ delay(50); }" };

  const simulator = new MultiBoardSimulator();
  simulator.attachProject(project);
  simulator.run();
  simulator.advance(0);
  const strip = simulator.getSnapshot().componentStates.device;
  assert.equal(strip.status, "Displaying");
  assert.equal(strip.readings?.litPixels, 3);
  assert.deepEqual(strip.pixels?.slice(0, 3), [
    { r: 96, g: 0, b: 0 },
    { r: 0, g: 96, b: 0 },
    { r: 0, g: 0, b: 96 },
  ]);
});

test("wired I2C supports a board peripheral's onReceive and onRequest callbacks", () => {
  const master = `#include <Wire.h>\nvoid setup(){ Wire.begin(); Serial.begin(9600); }\nvoid loop(){ Wire.beginTransmission(8); Wire.write(7); Wire.endTransmission(); Wire.requestFrom(8,1); if(Wire.available()){ Serial.println(Wire.read()); } delay(20); }`;
  const peripheral = `#include <Wire.h>\nvoid requestEvent(){ Wire.write(42); }\nvoid receiveEvent(int count){ while(Wire.available()){ int value=Wire.read(); Serial.println(value); } }\nvoid setup(){ Wire.begin(8); Wire.onReceive(receiveEvent); Wire.onRequest(requestEvent); }\nvoid loop(){ delay(10); }`;
  const project: CircuitProject = {
    ...mixedBoardProject(),
    code: master,
    programs: { mega: master, esp: peripheral },
    connections: [
      { id: "i2c-sda", from: { componentId: "mega", pin: "D20" }, to: { componentId: "esp", pin: "GPIO21" } },
      { id: "i2c-scl", from: { componentId: "mega", pin: "D21" }, to: { componentId: "esp", pin: "GPIO22" } },
      { id: "shared-ground", from: { componentId: "mega", pin: "GND" }, to: { componentId: "esp", pin: "GND" } },
    ],
  };
  const simulator = new MultiBoardSimulator(); simulator.attachProject(project); simulator.run(); simulator.advance(0); simulator.advance(40);
  const snapshot = simulator.getSnapshot();
  assert.ok(snapshot.boardSerial?.mega?.some(entry => entry.text === "42"), `master reads the callback response from its wired peripheral: ${JSON.stringify({ serial: snapshot.boardSerial, diagnostics: snapshot.diagnostics, esp: snapshot.boardSnapshots?.esp })}`);
  assert.ok(snapshot.boardSerial?.esp?.some(entry => entry.text === "7"), "peripheral receives master bytes in its onReceive callback");
  assert.equal(snapshot.diagnostics.some(diagnostic => diagnostic.code.startsWith("I2C_")), false, JSON.stringify(snapshot.diagnostics));

  const disconnected = structuredClone(project);
  disconnected.connections = disconnected.connections.filter(connection => connection.id !== "i2c-scl");
  const isolated = new MultiBoardSimulator(); isolated.attachProject(disconnected); isolated.run(); isolated.advance(0); isolated.advance(60);
  assert.equal(isolated.getSnapshot().boardSerial?.mega?.some(entry => entry.text === "42"), false);
  assert.ok(isolated.getSnapshot().diagnostics.some(diagnostic => diagnostic.code === "I2C_DEVICE_NOT_CONNECTED"), "missing SCL does not resolve a peripheral by component type alone");
});

test("I2C transactions are scoped to the running board and resolve same-address devices on isolated buses", () => {
  const project: CircuitProject = {
    ...createDefaultBlinkProject(),
    board: "arduino-mega-2560",
    activeBoardId: "mega",
    components: [
      { id: "mega", type: "arduino-mega-2560", label: "Mega", x: 0, y: 0 },
      { id: "esp", type: "esp32-devkitc-v4", label: "ESP32", x: 400, y: 0 },
      { id: "west", type: "bme280", label: "West sensor", x: 800, y: 0, properties: { temperature: 24, humidity: 40, pressure: 100100 } },
      { id: "east", type: "bme280", label: "East sensor", x: 1000, y: 0, properties: { temperature: 31, humidity: 65, pressure: 99000 } },
      { id: "radio", type: "rfm95w", label: "ESP radio", x: 1200, y: 0 },
      ...["west-sda", "west-scl", "east-sda", "east-scl"].map((id, index) => ({ id, type: "resistor", label: "I2C pull-up", x: 600, y: index * 40, properties: { resistance: 4700 } })),
    ],
    connections: [],
  };
  const wire = (fromId: string, fromPin: string, toId: string, toPin: string) => project.connections.push({ id: `wire-${project.connections.length}`, from: { componentId: fromId, pin: fromPin }, to: { componentId: toId, pin: toPin } });
  for (const [partPin, runtimePin] of [["MOSI", 23], ["MISO", 19], ["SCK", 18], ["NSS", 5]] as const) wire("radio", partPin, "esp", boardPinLabel("esp32-devkitc-v4", runtimePin));
  const bme = getComponentDefinition("bme280")!;
  for (const [boardId, deviceId, pins, pullupIds] of [
    ["mega", "west", [20, 21], ["west-sda", "west-scl"]],
    ["esp", "east", [21, 22], ["east-sda", "east-scl"]],
  ] as const) {
    const board = project.components.find(component => component.id === boardId)!;
    const device = project.components.find(component => component.id === deviceId)!;
    for (const supply of bme.metadata!.supplies) for (const pin of supply.pins) wire(device.id, pin, board.id, "3V3");
    for (const pin of bme.metadata!.groundPins) wire(device.id, pin, board.id, "GND");
    wire(device.id, "CSB", board.id, "3V3");
    wire(device.id, "SDI", board.id, boardPinLabel(board.type, pins[0]));
    wire(device.id, "SCK", board.id, boardPinLabel(board.type, pins[1]));
    for (const [index, pin] of ["SDI", "SCK"].entries()) {
      const resistor = project.components.find(component => component.id === pullupIds[index])!;
      wire(device.id, pin, resistor.id, "1");
      wire(resistor.id, "2", board.id, "3V3");
    }
  }

  const boardPins = {
    mega: createInitialPinStates("arduino-mega-2560"),
    esp: createInitialPinStates("esp32-devkitc-v4"),
  };
  const mega = new DeviceRuntime(project, "#include <Adafruit_BME280.h>\nAdafruit_BME280 sensor;", "arduino-mega-2560", "mega");
  const esp = new DeviceRuntime(project, "#include <Adafruit_BME280.h>\nAdafruit_BME280 sensor;", "esp32-devkitc-v4", "esp");
  mega.tick(0, boardPins.mega, [], boardPins);
  esp.tick(0, boardPins.esp, [], boardPins);
  const evaluate = (text: string) => Number(text);
  assert.equal(mega.invoke("sensor", "begin", [0x76], evaluate), 1);
  assert.equal(esp.invoke("sensor", "begin", [0x76], evaluate), 1);
  assert.equal(mega.invoke("sensor", "readTemperature", [], evaluate), 24);
  assert.equal(esp.invoke("sensor", "readTemperature", [], evaluate), 31);

  const megaWiring = new DeviceWiring(project, boardPins.mega, [], undefined, boardPins, "mega", "arduino-mega-2560");
  const espWiring = new DeviceWiring(project, boardPins.esp, [], undefined, boardPins, "esp", "esp32-devkitc-v4");
  assert.equal(megaWiring.spi(project.components.find(component => component.id === "radio")!, 53), false);
  assert.equal(espWiring.spi(project.components.find(component => component.id === "radio")!, 5), true);
});

test("ESP32 and ESP8266 expose board-scoped Wi-Fi UDP peers without internet access", () => {
  const code = `#include <WiFi.h>\n#include <WiFiUdp.h>\nWiFiUDP udp;\nvoid setup(){ WiFi.mode(WIFI_STA); WiFi.begin("CirkitraNet","cirkitra123"); udp.begin(4210); }\nvoid loop(){ udp.beginPacket("192.0.2.2",4210); udp.print("ping"); udp.endPacket(); if(udp.available()){ int value=udp.read(); Serial.println(value); } delay(100); }`;
  const properties = { networkSsid: "CirkitraNet", networkPassword: "cirkitra123", udpPeerEnabled: true, peerSsid: "CirkitraNet", peerPassword: "cirkitra123", peerAddress: "192.0.2.2", peerPort: 4210 };
  for (const boardType of ["esp32-devkitc-v4", "esp8266-nodemcu-v1"] as const) {
    const source = boardType === "esp8266-nodemcu-v1" ? code.replace("<WiFi.h>", "<ESP8266WiFi.h>") : code;
    const project: CircuitProject = { ...createDefaultBlinkProject(), board: boardType, activeBoardId: "esp", code: source, components: [{ id: "esp", type: boardType, label: boardType, x: 0, y: 0, properties }], connections: [] };
    const simulator = new ArduinoSimulator(source, { boardId: boardType, boardComponentId: "esp" }); simulator.attachProject(project);
    assert.equal(simulator.getCompiledSketch().valid, true, `${boardType}: ${JSON.stringify(simulator.getCompiledSketch().diagnostics)}`);
    simulator.run(); simulator.advance(0);
    const board = simulator.getSnapshot().componentStates.esp;
    assert.match(board.status ?? "", /Wi-Fi connected/);
    assert.ok(board.packets?.some(packet => packet.direction === "tx" && packet.status === "Delivered to virtual UDP peer"));
    assert.equal(simulator.injectPacket("esp", "Z"), true, `${boardType} accepts virtual peer data`);
    simulator.advance(100);
    assert.ok(simulator.getSnapshot().serial.some(entry => entry.text === "90"), `${boardType} sketch receives the incoming byte`);
    simulator.reset();
    assert.equal(simulator.getSnapshot().componentStates.esp.packets?.length, 0, "reset clears transient UDP packets");
  }

  assert.ok(compileArduinoSketch(code, "arduino-uno").diagnostics.some(item => item.code === "DEVICE_API_BOARD_UNSUPPORTED"));
  assert.ok(compileArduinoSketch(code.replace("CirkitraNet", "wrong network"), "esp32-devkitc-v4").valid);
  const failed = { ...createDefaultBlinkProject(), board: "esp32-devkitc-v4" as const, activeBoardId: "esp", code, components: [{ id: "esp", type: "esp32-devkitc-v4", label: "ESP32", x: 0, y: 0, properties: { ...properties, networkPassword: "incorrect" } }], connections: [] };
  const wrongNetwork = new ArduinoSimulator(code, { boardId: failed.board, boardComponentId: "esp" }); wrongNetwork.attachProject(failed); wrongNetwork.run(); wrongNetwork.advance(0);
  assert.ok(wrongNetwork.getSnapshot().diagnostics.some(item => item.code === "WIFI_CONNECT_FAILED"));
  assert.ok(wrongNetwork.getSnapshot().componentStates.esp.packets?.some(packet => packet.status.startsWith("Not delivered")));
});
