import test from "node:test";
import assert from "node:assert/strict";
import { COMPONENT_CATALOG } from "../circuit/catalog.ts";
import { COMPONENT_EXAMPLES } from "../circuit/component-examples.ts";
import { importCircuitProject, exportCircuitProject } from "../circuit/import.ts";
import { normalizeGroundReturns } from "../circuit/project.ts";
import { SCREENSHOT_COMPONENT_CONFIG, SCREENSHOT_PART_IDS } from "../circuit/screenshot-components.ts";
import { safeParseCircuitProject } from "../circuit/schema.ts";
import { solveCircuit } from "./circuit-state.ts";
import { ArduinoSimulator } from "./index.ts";

function create(id: string, properties?: Record<string, string | number | boolean>) {
  const project = COMPONENT_EXAMPLES[id]!();
  if (properties) project.components.find(component => component.id === "device")!.properties = properties;
  const board = project.components.find(component => component.type === project.board);
  const simulator = new ArduinoSimulator(project.code, { boardId: project.board, ...(board ? { boardComponentId: board.id } : {}) });
  simulator.attachProject(project);
  return { project, simulator };
}

test("every screenshot entry is catalogued, schema-v1 compatible, round-trippable, and has a compiling example", () => {
  for (const id of SCREENSHOT_PART_IDS) {
    const definition = COMPONENT_CATALOG[id];
    const project = normalizeGroundReturns(COMPONENT_EXAMPLES[id]!());
    assert.ok(definition, `${id} is visible in the shared catalog`);
    assert.equal(project.schemaVersion, 1, `${id} example uses the legacy saved-project schema`);
    assert.equal(safeParseCircuitProject(structuredClone(project)).success, true, id);
    const restored = importCircuitProject(exportCircuitProject(project));
    assert.equal(restored.ok, true, `${id} survives project export/import`);
    if (restored.ok) assert.deepEqual(restored.project, project, `${id} retains its schema-v1 project data`);
    const { simulator } = create(id);
    assert.equal(simulator.getCompiledSketch().valid, true, `${id}: ${simulator.getCompiledSketch().diagnostics.map(item => item.message).join("; ")}`);
    simulator.run();
    simulator.advance(0);
    assert.deepEqual(
      simulator.getSnapshot().diagnostics.filter(item => item.severity === "error").map(item => `${item.code}: ${item.message}`),
      [],
      `${id} example runs without simulator errors`,
    );
  }
});

test("all addressable pixel variants expose their exact pixel count and update through the shared NeoPixel runtime", () => {
  for (const [id, count] of [["neopixel-ring-24", 24], ["ws2812b-strip-30", 30], ["ws2812b-strip-60", 60], ["ws2812b-matrix-8x8", 64]] as const) {
    const { simulator } = create(id);
    simulator.run(); simulator.advance(0);
    const state = simulator.getSnapshot().componentStates.device;
    assert.equal(state.powered, true, id);
    assert.equal(state.pixels?.length, count, id);
    assert.equal(state.pixels?.[0]?.b, 255, `${id} displays the programmed blue pixel`);
    assert.equal(state.readings?.litPixels, 1, id);
  }
});

test("SPI display modules accept write-only and bidirectional board buses and expose simulated activity", () => {
  const ports: Record<string, { mosi: string; sck: string; cs: string; miso?: string }> = {
    "max7219-8x8-matrix": { mosi: "DIN", sck: "CLK", cs: "CS" },
    "st7735s-tft-1-8": { mosi: "SDA", sck: "SCL", cs: "CS" },
    "ili9341-tft-2-8": { mosi: "MOSI", miso: "MISO", sck: "SCK", cs: "CS" },
    "epaper-2-9-spi": { mosi: "DIN", sck: "CLK", cs: "CS" },
    "gc9a01-round-tft": { mosi: "SDA", sck: "SCL", cs: "CS" },
  };
  for (const [id, pins] of Object.entries(ports)) {
    const project = COMPONENT_EXAMPLES[id]!();
    const wire = (from: string, fromPin: string, to: string, toPin: string) => project.connections.push({
      id: `spi-${project.connections.length}`, from: { componentId: from, pin: fromPin }, to: { componentId: to, pin: toPin },
    });
    wire("device", pins.mosi, "uno", "D11");
    if (pins.miso) wire("device", pins.miso, "uno", "D12");
    wire("device", pins.sck, "uno", "D13");
    wire("device", pins.cs, "uno", "D10");
    if (id !== "max7219-8x8-matrix") project.code = "#include <SPI.h>\nvoid setup(){ pinMode(10,OUTPUT); SPI.begin(); digitalWrite(10,LOW); SPI.transfer(42); digitalWrite(10,HIGH); } void loop(){}";
    const simulator = new ArduinoSimulator(project.code); simulator.attachProject(project); simulator.run(); simulator.advance(0);
    const state = simulator.getSnapshot().componentStates.device;
    assert.equal(state.powered, true, id);
    assert.equal(state.status, "Displaying", id);
    if (id === "max7219-8x8-matrix") {
      assert.ok(Number(state.readings?.spiBytes) > 10, "example initializes the MAX7219 registers and writes a matrix pattern");
      assert.ok(Number(state.readings?.litPixels) > 0);
      assert.ok(state.display?.some(row => row.includes("#")));
    } else assert.equal(state.readings?.spiBytes, 1, id);
    assert.ok(!simulator.getSnapshot().diagnostics.some(item => item.code === "SPI_SELECTION"), id);

    const disconnected = structuredClone(project);
    disconnected.connections = disconnected.connections.filter(connection => ![connection.from, connection.to].some(endpoint => endpoint.componentId === "device" && endpoint.pin === pins.mosi));
    const broken = new ArduinoSimulator(disconnected.code); broken.attachProject(disconnected); broken.run(); broken.advance(0);
    assert.equal(broken.getSnapshot().componentStates.device.status, "SPI disconnected", id);
    assert.ok(broken.getSnapshot().diagnostics.some(item => item.code === "SPI_SELECTION"), id);
  }
});

test("MAX7219 output follows its shutdown, scan-limit, and row registers rather than arbitrary SPI traffic", () => {
  const project = COMPONENT_EXAMPLES["max7219-8x8-matrix"]!();
  const simulator = new ArduinoSimulator(project.code); simulator.attachProject(project); simulator.run(); simulator.advance(0);
  const active = simulator.getSnapshot().componentStates.device;
  assert.equal(active.status, "Displaying");
  assert.ok(Number(active.readings?.litPixels) > 0);
  assert.equal(active.readings?.scanLimit, 7);
  assert.ok(active.display?.some(row => row.includes("#")));

  const blank = structuredClone(project);
  blank.code = "#include <SPI.h>\nvoid setup(){ pinMode(10,OUTPUT); SPI.begin(); digitalWrite(10,LOW); SPI.transfer(42); digitalWrite(10,HIGH); } void loop(){}";
  const noPattern = new ArduinoSimulator(blank.code); noPattern.attachProject(blank); noPattern.run(); noPattern.advance(0);
  assert.equal(noPattern.getSnapshot().componentStates.device.status, "Shutdown");
  assert.equal(noPattern.getSnapshot().componentStates.device.readings?.litPixels, 0);
});

test("TM1637 and SH1107 adapters initialize the named display variants and expose their rendered output", () => {
  const tmProject = COMPONENT_EXAMPLES["tm1637-4-digit-display"]!();
  const tm = new ArduinoSimulator(tmProject.code);
  tm.attachProject(tmProject); tm.run(); tm.advance(0);
  const tmState = tm.getSnapshot().componentStates.device;
  assert.equal(tmState.status, "Displaying");
  assert.equal(tmState.readings?.value, 1234);
  assert.ok(tmState.display?.[0]?.includes("1234"));
  assert.ok(!tm.getSnapshot().diagnostics.some(item => item.severity === "error"));

  const disconnected = structuredClone(tmProject);
  disconnected.connections = disconnected.connections.filter(connection => ![connection.from, connection.to].some(endpoint => endpoint.componentId === "device" && endpoint.pin === "CLK"));
  const broken = new ArduinoSimulator(disconnected.code); broken.attachProject(disconnected); broken.run(); broken.advance(0);
  assert.notEqual(broken.getSnapshot().componentStates.device.status, "Displaying");
  assert.ok(broken.getSnapshot().diagnostics.some(item => item.code === "TM1637_NOT_CONNECTED"));

  const oledProject = COMPONENT_EXAMPLES["sh1107-oled-128x128"]!();
  const oled = new ArduinoSimulator(oledProject.code); oled.attachProject(oledProject); oled.run(); oled.advance(0);
  const oledState = oled.getSnapshot().componentStates.device;
  assert.equal(oledState.status, "Displaying");
  assert.equal(oledState.readings?.width, 128);
  assert.equal(oledState.readings?.height, 128);
  assert.ok(oledState.display?.some(line => line.includes("READY")));
  assert.ok(!oled.getSnapshot().diagnostics.some(item => item.severity === "error"));
});

test("MG996R acceptance example uses a dedicated 5 V rail with shared ground", () => {
  const project = COMPONENT_EXAMPLES["mg996r-servo"]!();
  const component = (id: string) => project.components.find(item => item.id === id);
  const connected = (a: string, aPin: string, b: string, bPin: string) => project.connections.some(connection =>
    (connection.from.componentId === a && connection.from.pin === aPin && connection.to.componentId === b && connection.to.pin === bPin)
    || (connection.to.componentId === a && connection.to.pin === aPin && connection.from.componentId === b && connection.from.pin === bPin));
  const supply = project.components.find(item => item.type === "dc-supply");
  assert.ok(supply, "an external supply is present");
  assert.equal(supply.properties?.voltage, 5);
  assert.ok(connected(supply.id, "+", "device", "VCC"));
  assert.ok(connected(supply.id, "-", "uno", "GND"));
  assert.ok(connected("device", "GND", "uno", "GND"));
  assert.ok(!connected("uno", "5V", "device", "VCC"), "high-current servo VCC is not taken from the board rail");
  assert.ok(component("device"));
});

test("DHT11 and waterproof DS18B20 use their digital sensor protocols and respond to interactive readings", () => {
  const dhtProject = COMPONENT_EXAMPLES.dht11!();
  dhtProject.components.find(component => component.id === "device")!.properties = { temperatureC: 31, humidityPct: 70 };
  const dht = new ArduinoSimulator(dhtProject.code); dht.attachProject(dhtProject); dht.run(); dht.advance(0);
  assert.equal(dht.getSnapshot().componentStates.device.readings?.temperature, 31);
  assert.equal(dht.getSnapshot().componentStates.device.readings?.humidity, 70);
  assert.ok(dht.getSnapshot().serial.some(item => item.text === "31"));
  assert.ok(dht.getSnapshot().serial.some(item => item.text === "70"));
  const noPullup = structuredClone(dhtProject);
  noPullup.connections = noPullup.connections.filter(connection => ![connection.from, connection.to].some(endpoint => endpoint.componentId === "pullup-data"));
  const brokenDht = new ArduinoSimulator(noPullup.code); brokenDht.attachProject(noPullup); brokenDht.run(); brokenDht.advance(0);
  assert.ok(brokenDht.getSnapshot().diagnostics.some(item => item.code === "DEVICE_NOT_CONNECTED"), "missing DHT data pull-up is not silently accepted");

  const probeProject = COMPONENT_EXAMPLES["ds18b20-waterproof"]!();
  probeProject.components.find(component => component.id === "device")!.properties = { temperatureC: 37.5 };
  const probe = new ArduinoSimulator(probeProject.code); probe.attachProject(probeProject); probe.run(); probe.advance(1000);
  assert.ok(probe.getSnapshot().serial.some(item => item.text === "37.5"), "DallasTemperature conversion reads the waterproof variant's control value");
});

test("analog and switch controls change observable circuit values, while missing power fails safe", () => {
  const pirProject = COMPONENT_EXAMPLES["hc-sr501"]!();
  const pir = new ArduinoSimulator(pirProject.code); pir.attachProject(pirProject); pir.run(); pir.advance(0);
  assert.equal(pir.getSnapshot().componentStates.device.channels?.OUT, 0);
  const movingPir = { ...pirProject, components: pirProject.components.map(component => component.id === "device" ? { ...component, properties: { ...component.properties, motion: true } } : component) };
  pir.attachProject(movingPir); pir.advance(0);
  assert.equal(pir.getSnapshot().componentStates.device.channels?.OUT, 1);
  const unpoweredPir = { ...movingPir, connections: movingPir.connections.filter(connection => ![connection.from, connection.to].some(endpoint => endpoint.componentId === "device" && endpoint.pin === "VCC")) };
  pir.attachProject(unpoweredPir); pir.advance(0);
  assert.equal(pir.getSnapshot().componentStates.device.powered, false);
  assert.ok(solveCircuit(unpoweredPir, pir.getSnapshot()).diagnostics.some(item => item.code === "component-unpowered"));

  const joystickProject = COMPONENT_EXAMPLES["ky-023-joystick"]!();
  const joystick = new ArduinoSimulator(joystickProject.code); joystick.attachProject(joystickProject); joystick.run(); joystick.advance(0);
  const initial = solveCircuit(joystickProject, joystick.getSnapshot()).analogInputs;
  const moved = { ...joystickProject, components: joystickProject.components.map(component => component.id === "device" ? { ...component, properties: { ...component.properties, x: 10, y: 90 } } : component) };
  joystick.attachProject(moved); joystick.advance(0);
  const movedInputs = solveCircuit(moved, joystick.getSnapshot()).analogInputs;
  assert.ok(initial[14] > 500 && initial[15] > 500);
  assert.ok(movedInputs[14] < 150 && movedInputs[15] > 850, "the joystick's independent axes reach A0 and A1");

  const dipProject = COMPONENT_EXAMPLES["dip-switch-8"]!();
  const dip = new ArduinoSimulator(dipProject.code); dip.attachProject(dipProject); dip.run(); dip.advance(0);
  assert.equal(dip.getSnapshot().serial.at(-1)?.text, "1");
  const on = { ...dipProject, components: dipProject.components.map(component => component.id === "device" ? { ...component, properties: { ...component.properties, switch1: true } } : component) };
  dip.attachProject(on); dip.advance(0);
  dip.advance(100);
  assert.equal(dip.getSnapshot().serial.at(-1)?.text, "0", "closing switch 1 pulls the input low");
});

test("I²C variants detect missing buses and expose interactive sensor values", () => {
  const ids = Object.keys(SCREENSHOT_COMPONENT_CONFIG).filter(id => SCREENSHOT_COMPONENT_CONFIG[id]!.family === "i2c-sensor");
  assert.ok(ids.length >= 9);
  for (const id of ids) {
    const { project, simulator } = create(id);
    simulator.run(); simulator.advance(0);
    assert.equal(simulator.getSnapshot().componentStates.device.status, "I²C ready", id);
    const disconnected = { ...project, connections: project.connections.filter(connection => ![connection.from, connection.to].some(endpoint => endpoint.componentId === "device" && endpoint.pin === "SDA")) };
    const broken = new ArduinoSimulator(disconnected.code); broken.attachProject(disconnected); broken.run(); broken.advance(0);
    assert.equal(broken.getSnapshot().componentStates.device.status, "I²C disconnected", id);
  }
});

test("capacitors retain simulated-time RC state, NE555 latches across its threshold, and 9 V source is not treated as 5 V", () => {
  for (const id of ["capacitor-1uf", "electrolytic-capacitor-100uf"]) {
    const { simulator } = create(id); simulator.run(); simulator.advance(0);
    const initial = simulator.getSnapshot().componentStates.device.readings?.voltage ?? 0;
    simulator.advance(100);
    const charged = simulator.getSnapshot().componentStates.device.readings?.voltage ?? 0;
    assert.ok(charged > initial, `${id} charges after simulated time`);
    simulator.pause(); const time = simulator.getSnapshot().timeMs;
    simulator.advance(1000);
    assert.equal(simulator.getSnapshot().timeMs, time);
    assert.equal(simulator.getSnapshot().componentStates.device.readings?.voltage, charged, "paused time preserves capacitor state");
    simulator.reset(); assert.equal(simulator.getSnapshot().timeMs, 0, "reset returns simulated time to zero");
  }

  const { simulator: timer } = create("ne555-timer"); timer.run(); timer.advance(0);
  assert.equal(timer.getSnapshot().componentStates.device.status, "Output HIGH", "a low trigger sets the internal latch");
  timer.advance(100);
  assert.equal(timer.getSnapshot().componentStates.device.status, "Output LOW", "threshold above two-thirds VCC resets the latch");
  const { simulator: battery } = create("battery-9v"); battery.run(); battery.advance(0);
  assert.equal(battery.getSnapshot().componentStates.device.readings?.voltage, 9);
});

test("breadboard row groups are named electrical endpoints and isolated groups remain distinct", () => {
  for (const id of ["breadboard-half", "breadboard-full"]) {
    const definition = COMPONENT_CATALOG[id]!;
    const names = definition.pins.map(pin => pin.id);
    assert.ok(names.includes("A1-E1") && names.includes("F1-J1"));
    assert.ok(names.some(name => /^L\+_1-\d+$/.test(name)), "rail endpoints carry explicit row extents");
    assert.equal(new Set(names).size, names.length);
    assert.ok(definition.metadata?.notes.some(note => note.includes("center trench")));
  }
});

test("TMC2209/NEMA17 and ULN2003/28BYJ-48 stepper pairs move only through powered, wired commands", () => {
  for (const [driverId, motorId] of [["tmc2209-stepper-driver", "nema17-stepper-17hs4401s"], ["uln2003-stepper-driver", "stepper-28byj-48"]] as const) {
    for (const exampleId of [driverId, motorId]) {
      const project = COMPONENT_EXAMPLES[exampleId]!();
      const simulator = new ArduinoSimulator(project.code); simulator.attachProject(project);
      assert.equal(simulator.getCompiledSketch().valid, true, `${exampleId}: ${simulator.getCompiledSketch().diagnostics.map(item => item.message).join("; ")}`);
      simulator.run(); simulator.advance(250);
      const motor = project.components.find(component => component.type === motorId)!;
      assert.ok(simulator.getSnapshot().componentStates[motor.id]?.powered, `${exampleId}: motor path is powered`);
      assert.ok(Number(simulator.getSnapshot().componentStates[motor.id]?.readings?.steps) > 0, `${exampleId}: sketch phases or STEP edges advance the motor`);
      assert.ok(Math.abs(Number(simulator.getSnapshot().componentStates[motor.id]?.readings?.angleDegrees)) > 0, `${exampleId}: motor pose follows its steps`);
    }
  }

  const tmc = COMPONENT_EXAMPLES["tmc2209-stepper-driver"]!();
  const disabled = { ...tmc, code: tmc.code.replace("digitalWrite(4,LOW)", "digitalWrite(4,HIGH)") };
  const stopped = new ArduinoSimulator(disabled.code); stopped.attachProject(disabled); stopped.run(); stopped.advance(250);
  assert.equal(stopped.getSnapshot().componentStates["stepper-motor"]?.readings?.steps, 0, "active-high EN disables the TMC2209 movement path");

  const unpowered = COMPONENT_EXAMPLES["uln2003-stepper-driver"]!();
  unpowered.connections = unpowered.connections.filter(connection => ![connection.from, connection.to].some(endpoint => endpoint.componentId === "stepper-motor" && endpoint.pin === "COM"));
  const noMotorRail = new ArduinoSimulator(unpowered.code); noMotorRail.attachProject(unpowered); noMotorRail.run(); noMotorRail.advance(250);
  assert.equal(noMotorRail.getSnapshot().componentStates["stepper-motor"]?.readings?.steps, 0, "an unpowered 28BYJ common winding cannot move");
});

test("A4988 runs with RESET and SLEEP strapped HIGH to VDD without spending GPIO pins", () => {
  const project = COMPONENT_EXAMPLES["a4988-stepper-driver"]!();
  project.connections = project.connections.filter(connection => ![connection.from, connection.to].some(endpoint =>
    endpoint.componentId === "device" && ["RST", "SLP"].includes(endpoint.pin)));
  project.connections.push(
    { id: "reset-vdd-strap", from: { componentId: "device", pin: "RST" }, to: { componentId: "device", pin: "VDD" } },
    { id: "sleep-vdd-strap", from: { componentId: "device", pin: "SLP" }, to: { componentId: "device", pin: "VDD" } },
  );
  const board = project.components.find(component => component.type === project.board);
  const simulator = new ArduinoSimulator(project.code, { boardId: project.board, ...(board ? { boardComponentId: board.id } : {}) });
  simulator.attachProject(project); simulator.run(); simulator.advance(250);
  const state = simulator.getSnapshot();
  assert.ok(!state.diagnostics.some(diagnostic => diagnostic.code === "A4988_CONTROL_DISCONNECTED"), "the shared, powered RESET/SLEEP net is a valid A4988 control configuration");
  assert.ok(Number(state.componentStates.motor?.readings?.steps) > 0, "the powered driver advances the connected motor with only STEP/DIR/EN on GPIO");

  const heldInReset = structuredClone(project);
  heldInReset.connections = heldInReset.connections.map(connection =>
    connection.id === "reset-vdd-strap" || connection.id === "sleep-vdd-strap"
      ? { ...connection, to: { componentId: "uno", pin: "GND" } }
      : connection);
  const resetSimulator = new ArduinoSimulator(heldInReset.code, { boardId: heldInReset.board, boardComponentId: "uno" });
  resetSimulator.attachProject(heldInReset); resetSimulator.run(); resetSimulator.advance(250);
  assert.equal(resetSimulator.getSnapshot().componentStates.motor?.readings?.steps, 0, "a shared RESET/SLEEP net held LOW must not move the motor");
});

test("simulates a nested full-step coil table and advances the 28BYJ-48 in both coil patterns", () => {
  const project = COMPONENT_EXAMPLES["uln2003-stepper-driver"]!();
  project.code = `const int fullStepSequence[4][4] = {
    {1, 1, 0, 0},
    {0, 1, 1, 0},
    {0, 0, 1, 1},
    {1, 0, 0, 1}
  };
  int stepNumber = 0;
  void setup() { pinMode(2,OUTPUT); pinMode(3,OUTPUT); pinMode(4,OUTPUT); pinMode(5,OUTPUT); }
  void loop() {
    digitalWrite(2, fullStepSequence[stepNumber][0]);
    digitalWrite(3, fullStepSequence[stepNumber][1]);
    digitalWrite(4, fullStepSequence[stepNumber][2]);
    digitalWrite(5, fullStepSequence[stepNumber][3]);
    stepNumber = (stepNumber + 1) % 4;
    delay(5);
  }`;
  const simulator = new ArduinoSimulator(project.code);
  simulator.attachProject(project);
  assert.equal(simulator.getCompiledSketch().valid, true, JSON.stringify(simulator.getCompiledSketch().diagnostics));
  simulator.run();
  simulator.advance(250);
  const steps = Number(simulator.getSnapshot().componentStates["stepper-motor"]?.readings?.steps ?? 0);
  assert.ok(steps > 0, `full-step sequence should move the powered 28BYJ-48, got ${steps} steps`);
});

test("JSN-SR04T maps its configured distance to the wired board echo pulse", () => {
  const project = COMPONENT_EXAMPLES["jsn-sr04t-ultrasonic"]!();
  project.components.find(component => component.id === "device")!.properties = { distanceCm: 42 };
  const simulator = new ArduinoSimulator(project.code); simulator.attachProject(project); simulator.run(); simulator.advance(100);
  assert.equal(simulator.getSnapshot().componentStates.device.powered, true);
  assert.ok(simulator.getSnapshot().serial.some(item => Number(item.text) === 42 * 58.3), `pulseIn observes the configured ultrasonic echo duration; got ${JSON.stringify(simulator.getSnapshot().serial)}; state ${JSON.stringify(simulator.getSnapshot().componentStates.device)}; diagnostics ${JSON.stringify(simulator.getSnapshot().diagnostics)}`);

  const disconnected = structuredClone(project);
  disconnected.connections = disconnected.connections.filter(connection => ![connection.from, connection.to].some(endpoint => endpoint.componentId === "device" && endpoint.pin === "ECHO"));
  const noEcho = new ArduinoSimulator(disconnected.code); noEcho.attachProject(disconnected); noEcho.run(); noEcho.advance(100);
  assert.ok(noEcho.getSnapshot().serial.some(item => item.text === "0"), "a disconnected echo pin produces no distance pulse");
});
