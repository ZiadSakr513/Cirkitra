import type { CircuitProject } from "./types.ts";

/** Portable examples also serve as executable publication fixtures. */
function example(type: string): CircuitProject {
  return { schemaVersion: 1, id: `example-${type}`, name: `${type.toUpperCase()} demonstration`, description: "A wired, executable component example.", board: "arduino-uno", code: "", components: [
    { id: "uno", type: "arduino-uno", label: "Controller", x: 0, y: 0 },
    { id: "device", type, label: type.toUpperCase(), x: 520, y: 0 },
  ], connections: [] };
}
function wiring(project: CircuitProject) {
  const wire = (a: string, pin: string, b: string, other: string) => project.connections.push({ id: `wire-${project.connections.length}`, from: { componentId: a, pin }, to: { componentId: b, pin: other } });
  return { wire, rail: (pin: string, source = "5V") => wire("device", pin, "uno", source) };
}
function muxExample(type: string): CircuitProject {
  const p = example(type), { wire, rail } = wiring(p);
  rail("VCC"); rail("GND", "GND"); rail("E", "GND");
  if (type === "cd74hc4051") rail("VEE", "GND");
  const selectors = type === "cd74hc4067" ? 4 : 3;
  for (let bit = 0; bit < selectors; bit++) rail(`S${bit}`, bit ? "GND" : "D2");
  const prefix = type === "cd74hc4067" ? "I" : "A";
  rail(`${prefix}0`, "GND"); rail(`${prefix}1`);
  wire("device", "COM", "uno", "A0");
  p.code = `void setup(){ Serial.begin(9600); pinMode(2, OUTPUT); }
void loop(){ digitalWrite(2, LOW); Serial.println(analogRead(A0)); delay(500); digitalWrite(2, HIGH); Serial.println(analogRead(A0)); delay(500); }`;
  return p;
}
function decoderExample(): CircuitProject {
  const p = example("74hc138"), { wire, rail } = wiring(p);
  rail("VCC"); rail("GND", "GND"); rail("E1", "GND"); rail("E2", "GND"); rail("E3");
  rail("A0", "D2"); rail("A1", "GND"); rail("A2", "GND");
  p.components.push({ id: "led", type: "led", label: "Selected output 0", x: 850, y: 0 }, { id: "resistor", type: "resistor", label: "220 ohm", x: 850, y: 160, properties: { resistance: 220 } });
  wire("uno", "5V", "resistor", "1"); wire("resistor", "2", "led", "A"); wire("led", "K", "device", "Y0");
  p.code = "void setup(){ pinMode(2, OUTPUT); } void loop(){ digitalWrite(2, LOW); delay(500); digitalWrite(2, HIGH); delay(500); }";
  return p;
}
function driverExample(type: string): CircuitProject {
  const p = example(type), { wire, rail } = wiring(p);
  const supplies = type === "tb6612fng" ? ["VCC", "VM1", "VM2", "VM3"] : type === "drv8833" ? ["VM"] : ["VSS", "VS"];
  const grounds = type === "tb6612fng" ? ["GND", "PGND1_3", "PGND1_4", "PGND2_9", "PGND2_10"] : type === "drv8833" ? ["GND", "AISEN", "BISEN"] : ["GND", "SENSE_A", "SENSE_B"];
  supplies.forEach(pin => rail(pin)); grounds.forEach(pin => rail(pin, "GND"));
  if (type !== "l298") rail(type === "tb6612fng" ? "STBY" : "nSLEEP");
  const a = type === "l298" ? ["IN1", "IN2", "OUT1", "OUT2", "ENA"] : type === "tb6612fng" ? ["AIN1", "AIN2", "AO1_1", "AO2_5", "PWMA"] : ["AIN1", "AIN2", "AOUT1", "AOUT2"];
  const b = type === "l298" ? ["IN3", "IN4", "OUT3", "OUT4", "ENB"] : type === "tb6612fng" ? ["BIN1", "BIN2", "BO1_12", "BO2_8", "PWMB"] : ["BIN1", "BIN2", "BOUT1", "BOUT2"];
  rail(a[0], a[4] ? "5V" : "D5"); rail(a[1], "GND"); rail(b[0], "GND"); rail(b[1], b[4] ? "5V" : "D6");
  if (a[4]) { rail(a[4], "D5"); rail(b[4], "D6"); }
  for (const [id, channel, y] of [["motor-a", a, 0], ["motor-b", b, 220]] as const) {
    p.components.push({ id, type: "dc-motor", label: id, x: 900, y });
    wire("device", channel[2], id, "+"); wire("device", channel[3], id, "-");
  }
  p.code = "void setup(){ pinMode(5, OUTPUT); pinMode(6, OUTPUT); analogWrite(5,128); analogWrite(6,255); } void loop(){ delay(1000); }";
  return p;
}
function getPins(type: string) { return ({ bme280: ["GND_1", "GND_7"], bmp280: ["GND_1", "GND_7"], "sht31-dis": ["VSS", "R", "EP"] } as Record<string, string[]>)[type] ?? []; }
function i2cSensorExample(type: "bme280" | "bmp280" | "sht31-dis"): CircuitProject {
  const p = example(type), { wire, rail } = wiring(p);
  const supplyPins = type === "sht31-dis" ? ["VDD", "nRESET"] : ["VDD", "VDDIO", "CSB"];
  supplyPins.forEach(pin => rail(pin, "3V3")); getPins(type).forEach(pin => rail(pin, "GND"));
  if (type === "sht31-dis") rail("ADDR", "GND"); else rail("SDO", "GND");
  for (const pin of type === "sht31-dis" ? ["SDA", "SCL"] : ["SDI", "SCK"]) {
    wire("device", pin, "uno", pin === "SDA" || pin === "SDI" ? "A4" : "A5");
    const resistor = `pullup-${pin}`;
    p.components.push({ id: resistor, type: "resistor", label: "4.7 kΩ bus pull-up", x: 260, y: pin === "SDA" || pin === "SDI" ? -90 : 90, properties: { resistance: 4700 } });
    wire("device", pin, resistor, "1"); wire(resistor, "2", "uno", "3V3");
  }
  p.code = type === "sht31-dis"
    ? `#include <Adafruit_SHT31.h>\nAdafruit_SHT31 sensor; void setup(){ Serial.begin(9600); sensor.begin(0x44); } void loop(){ Serial.println(sensor.readTemperature()); Serial.println(sensor.readHumidity()); delay(1000); }`
    : `#include <${type === "bme280" ? "Adafruit_BME280.h" : "Adafruit_BMP280.h"}>\n${type === "bme280" ? "Adafruit_BME280" : "Adafruit_BMP280"} sensor; void setup(){ Serial.begin(9600); sensor.begin(0x76); } void loop(){ Serial.println(sensor.readTemperature()); Serial.println(sensor.readPressure()); ${type === "bme280" ? "Serial.println(sensor.readHumidity());" : ""} delay(1000); }`;
  return p;
}
function oneWireExample(): CircuitProject {
  const p = example("ds18b20"), { wire } = wiring(p);
  wire("device", "VDD", "uno", "5V"); wire("device", "GND", "uno", "GND"); wire("device", "DQ", "uno", "D2");
  p.components.push({ id: "pullup-dq", type: "resistor", label: "4.7 kΩ data pull-up", x: 260, y: 0, properties: { resistance: 4700 } });
  wire("device", "DQ", "pullup-dq", "1"); wire("pullup-dq", "2", "uno", "5V");
  p.code = `#include <OneWire.h>\n#include <DallasTemperature.h>\nOneWire bus(2); DallasTemperature sensors(&bus); void setup(){ Serial.begin(9600); sensors.begin(); } void loop(){ sensors.requestTemperatures(); Serial.println(sensors.getTempCByIndex(0)); delay(1000); }`;
  return p;
}
function dhtExample(): CircuitProject {
  const p = example("dht22"), { wire } = wiring(p);
  wire("device", "VDD", "uno", "5V"); wire("device", "GND", "uno", "GND"); wire("device", "DATA", "uno", "D2");
  p.components.push({ id: "pullup-data", type: "resistor", label: "4.7 kΩ data pull-up", x: 260, y: 0, properties: { resistance: 4700 } });
  wire("device", "DATA", "pullup-data", "1"); wire("pullup-data", "2", "uno", "5V");
  p.code = `#include <DHT.h>\nDHT sensor(2, DHT22); void setup(){ Serial.begin(9600); sensor.begin(); } void loop(){ Serial.println(sensor.readTemperature()); Serial.println(sensor.readHumidity()); delay(2000); }`;
  return p;
}
function imuExample(): CircuitProject {
  const p = example("mpu-6050"), { wire, rail } = wiring(p);
  p.components[1].properties = { ax: 1.25, gz: 0.5, temperature: 25 };
  rail("VDD", "3V3"); rail("VLOGIC", "3V3"); rail("GND", "GND"); rail("AD0", "GND");
  for (const pin of ["SDA", "SCL"]) {
    wire("device", pin, "uno", pin === "SDA" ? "A4" : "A5");
    const resistor = `pullup-${pin}`;
    p.components.push({ id: resistor, type: "resistor", label: "4.7 kΩ bus pull-up", x: 260, y: pin === "SDA" ? -90 : 90, properties: { resistance: 4700 } });
    wire("device", pin, resistor, "1"); wire(resistor, "2", "uno", "3V3");
  }
  p.code = `#include <Adafruit_MPU6050.h>\n#include <Adafruit_Sensor.h>\nAdafruit_MPU6050 sensor; sensors_event_t acceleration, gyro, temperature; void setup(){ Serial.begin(9600); sensor.begin(); } void loop(){ sensor.getEvent(&acceleration, &gyro, &temperature); Serial.println(acceleration.acceleration.x); Serial.println(gyro.gyro.z); Serial.println(temperature.temperature); delay(100); }`;
  return p;
}
function tcaExample(): CircuitProject {
  const p = example("tca9548a"), { wire, rail } = wiring(p);
  rail("VCC", "3V3"); rail("GND", "GND"); rail("RESET"); rail("A0", "GND"); rail("A1", "GND"); rail("A2", "GND");
  for (const pin of ["SDA", "SCL"]) {
    wire("device", pin, "uno", pin === "SDA" ? "A4" : "A5");
    const resistor = `upstream-${pin}`;
    p.components.push({ id: resistor, type: "resistor", label: "Upstream 4.7 kΩ pull-up", x: 250, y: pin === "SDA" ? -100 : 110, properties: { resistance: 4700 } });
    wire("device", pin, resistor, "1"); wire(resistor, "2", "uno", "3V3");
  }
  p.components.push({ id: "sensor", type: "bmp280", label: "BMP280 on channel 0", x: 1000, y: 0, properties: { temperature: 29, pressure: 100250 } });
  for (const pin of ["VDD", "VDDIO", "CSB"]) wire("sensor", pin, "uno", "3V3");
  wire("sensor", "SDO", "uno", "GND"); wire("sensor", "GND_1", "uno", "GND"); wire("sensor", "GND_7", "uno", "GND");
  wire("sensor", "SDI", "device", "SD0"); wire("sensor", "SCK", "device", "SC0");
  for (const pin of ["SDI", "SCK"]) {
    const resistor = `downstream-${pin}`;
    p.components.push({ id: resistor, type: "resistor", label: "Channel 0 4.7 kΩ pull-up", x: 700, y: pin === "SDI" ? -100 : 110, properties: { resistance: 4700 } });
    wire("sensor", pin, resistor, "1"); wire(resistor, "2", "uno", "3V3");
  }
  p.code = `#include <TCA9548.h>\n#include <Adafruit_BMP280.h>\nTCA9548 mux(0x70); Adafruit_BMP280 sensor; void setup(){ Serial.begin(9600); mux.begin(); mux.selectChannel(0); sensor.begin(0x76); } void loop(){ Serial.println(sensor.readTemperature()); Serial.println(sensor.readPressure()); delay(500); }`;
  return p;
}
function mcpExample(): CircuitProject {
  const p = example("mcp23017"), { wire, rail } = wiring(p);
  rail("VDD", "3V3"); rail("RESET"); rail("A0", "GND"); rail("A1", "GND"); rail("A2", "GND"); rail("VSS", "GND");
  for (const pin of ["SDA", "SCL"]) {
    wire("device", pin, "uno", pin === "SDA" ? "A4" : "A5");
    const resistor = `pullup-${pin}`;
    p.components.push({ id: resistor, type: "resistor", label: "4.7 kΩ bus pull-up", x: 250, y: pin === "SDA" ? -100 : 110, properties: { resistance: 4700 } });
    wire("device", pin, resistor, "1"); wire(resistor, "2", "uno", "3V3");
  }
  p.components.push({ id: "resistor-led", type: "resistor", label: "220 Ω", x: 850, y: 0, properties: { resistance: 220 } }, { id: "led", type: "led", label: "Expander output", x: 1080, y: 0 });
  wire("device", "GPA0", "resistor-led", "1"); wire("resistor-led", "2", "led", "A"); wire("led", "K", "uno", "GND");
  p.code = `#include <Adafruit_MCP23X17.h>\nAdafruit_MCP23X17 expander; void setup(){ expander.begin_I2C(0x20); expander.pinMode(0, OUTPUT); } void loop(){ expander.digitalWrite(0, HIGH); delay(250); expander.digitalWrite(0, LOW); delay(250); }`;
  return p;
}
function shiftRegisterExample(): CircuitProject {
  const p = example("74hc595"), { wire, rail } = wiring(p);
  rail("VCC"); rail("GND", "GND"); rail("MR"); rail("OE", "GND");
  for (const [pin, board] of [["DS", "D2"], ["SHCP", "D3"], ["STCP", "D4"]] as const) wire("device", pin, "uno", board);
  p.components.push({ id: "resistor-led", type: "resistor", label: "220 Ω", x: 850, y: 0, properties: { resistance: 220 } }, { id: "led", type: "led", label: "Shift register output Q0", x: 1080, y: 0 });
  wire("device", "Q0", "resistor-led", "1"); wire("resistor-led", "2", "led", "A"); wire("led", "K", "uno", "GND");
  p.code = `void setup(){ pinMode(2, OUTPUT); pinMode(3, OUTPUT); pinMode(4, OUTPUT); digitalWrite(4, LOW); } void loop(){ digitalWrite(4, LOW); shiftOut(2, 3, MSBFIRST, 1); digitalWrite(4, HIGH); digitalWrite(4, LOW); delay(500); digitalWrite(4, LOW); shiftOut(2, 3, MSBFIRST, 0); digitalWrite(4, HIGH); digitalWrite(4, LOW); delay(500); }`;
  return p;
}
function loraExample(): CircuitProject {
  const p = example("rfm95w"), { wire, rail } = wiring(p);
  p.components[1].properties = { peerEnabled: true, peerFrequency: 915000000, peerBandwidth: 125000, peerSpreading: 7, peerCoding: 5, peerSyncWord: 18, peerCrc: false };
  for (const pin of ["GND_1", "GND_8", "GND_10"]) rail(pin, "GND"); rail("VCC", "3V3");
  for (const [pin, board] of [["MOSI", "D11"], ["MISO", "D12"], ["SCK", "D13"], ["NSS", "D10"], ["RESET", "D9"], ["DIO0", "D2"]] as const) wire("device", pin, "uno", board);
  p.code = `#include <SPI.h>\n#include <LoRa.h>\nvoid setup(){ Serial.begin(9600); pinMode(10, OUTPUT); pinMode(9, OUTPUT); pinMode(2, INPUT); digitalWrite(9, HIGH); LoRa.setPins(10,9,2); LoRa.begin(915000000); } void loop(){ LoRa.beginPacket(); LoRa.print("hello"); LoRa.endPacket(); LoRa.receive(); delay(1000); }`;
  return p;
}
function xbeeExample(): CircuitProject {
  const p = example("xbee-s2c-zigbee-th"), { wire, rail } = wiring(p);
  p.components[1].properties = { apiMode: 2, baudRate: 9600, peerEnabled: true, panId: 4660, peerPanId: 4660, destination: "0013A20000000001" };
  rail("VCC", "3V3"); rail("GND", "GND"); rail("RESET", "5V"); rail("DIO8", "GND");
  wire("device", "DOUT", "uno", "D2"); wire("device", "DIN", "uno", "D3");
  p.code = `#include <XBee.h>\n#include <SoftwareSerial.h>\nSoftwareSerial port(2,3); XBee radio; XBeeAddress64 address(0x0013a200,1); byte payload[2]={65,66}; ZBTxRequest request(address,payload,sizeof(payload)); ZBTxStatusResponse response; void setup(){ Serial.begin(9600); port.begin(9600); radio.setSerial(port); radio.begin(9600); delay(150); } void loop(){ radio.send(request); delay(20); radio.readPacket(); if(radio.getResponse().isAvailable() && radio.getResponse().getApiId()==ZB_TX_STATUS_RESPONSE){ radio.getResponse().getZBTxStatusResponse(response); Serial.println(response.getDeliveryStatus()); } delay(1000); }`;
  return p;
}
function powerPrimitiveExample(type: "dc-supply" | "battery-cell" | "dc-load" | "ideal-mosfet"): CircuitProject {
  const p = example(type);
  const sourceId = type === "dc-supply" ? "device" : "source";
  const cellId = type === "battery-cell" ? "device" : "cell";
  const loadId = type === "dc-load" ? "device" : "system-load";
  const switchId = type === "ideal-mosfet" ? "device" : "switch";
  const add = (id: string, part: string, label: string, x: number, y: number, properties?: Record<string, number | boolean>) => p.components.push({ id, type: part, label, x, y, properties });
  if (sourceId !== "device") add(sourceId, "dc-supply", "5 V bench supply", 250, -180, { voltage: 5, enabled: true });
  else p.components[1].properties = { voltage: 5, enabled: true };
  if (cellId !== "device") add(cellId, "battery-cell", "Single-cell Li-ion battery", 250, 200, { initialSoc: 72, capacityMah: 2000, temperature: 25 });
  else p.components[1].properties = { initialSoc: 72, capacityMah: 2000, temperature: 25 };
  if (loadId !== "device") add(loadId, "dc-load", "100 Ω switched load", 780, -150, { resistance: 100 });
  else p.components[1].properties = { resistance: 100 };
  if (switchId !== "device") add(switchId, "ideal-mosfet", "Low-side switch", 780, 100, { threshold: 2.5 });
  else p.components[1].properties = { threshold: 2.5 };
  const { wire } = wiring(p);
  add("battery-load", "dc-load", "Battery load", 780, 240, { resistance: 39 });
  wire(sourceId, "+", loadId, "+"); wire(loadId, "-", switchId, "D"); wire(switchId, "S", sourceId, "-"); wire(sourceId, "-", "uno", "GND"); wire(switchId, "G", "uno", "D5");
  wire(cellId, "+", "battery-load", "+"); wire("battery-load", "-", cellId, "-"); wire(cellId, "-", "uno", "GND");
  p.code = "void setup(){ pinMode(5, OUTPUT); } void loop(){ digitalWrite(5, HIGH); delay(500); digitalWrite(5, LOW); delay(500); }";
  return p;
}
function bq27441Example(): CircuitProject {
  const p = example("bq27441-g1"), { wire } = wiring(p);
  p.components[1].properties = {};
  p.components.push(
    { id: "cell", type: "battery-cell", label: "Single-cell Li-ion battery", x: 1100, y: 0, properties: { initialSoc: 72, capacityMah: 2000, temperature: 25 } },
    { id: "load", type: "dc-load", label: "System load", x: 1100, y: 220, properties: { resistance: 39 } },
    { id: "sense", type: "resistor", label: "10 mΩ current sense", x: 850, y: 260, properties: { resistance: 0.01 } },
    { id: "bin", type: "resistor", label: "10 kΩ insertion detect", x: 250, y: 250, properties: { resistance: 10000 } },
  );
  wire("device", "BAT", "cell", "+"); wire("device", "VSS", "uno", "GND"); wire("device", "EP", "uno", "GND"); wire("cell", "-", "uno", "GND");
  wire("load", "+", "cell", "+"); wire("load", "-", "sense", "1"); wire("sense", "2", "cell", "-");
  wire("device", "SRP", "sense", "2"); wire("device", "SRN", "sense", "1"); wire("device", "BIN", "bin", "1"); wire("bin", "2", "uno", "GND");
  for (const pin of ["SDA", "SCL"]) {
    wire("device", pin, "uno", pin === "SDA" ? "A4" : "A5");
    const resistor = `pullup-${pin}`;
    p.components.push({ id: resistor, type: "resistor", label: "4.7 kΩ bus pull-up", x: 250, y: pin === "SDA" ? -100 : 100, properties: { resistance: 4700 } });
    wire("device", pin, resistor, "1"); wire(resistor, "2", "uno", "3V3");
  }
  p.code = `#include <SparkFunBQ27441.h>\nvoid setup(){ Serial.begin(9600); lipo.begin(); lipo.setCapacity(2000); } void loop(){ Serial.println(lipo.voltage()); Serial.println(lipo.current()); Serial.println(lipo.soc()); delay(1000); }`;
  return p;
}
function bq24074Example(): CircuitProject {
  const p = example("bq24074"), { wire } = wiring(p);
  p.components[1].properties = {};
  p.components.push(
    { id: "input", type: "dc-supply", label: "5 V adapter", x: 250, y: -170, properties: { voltage: 5, enabled: true } },
    { id: "cell", type: "battery-cell", label: "Single-cell Li-ion battery", x: 1100, y: 0, properties: { initialSoc: 50, capacityMah: 1000, temperature: 25 } },
    { id: "load", type: "dc-load", label: "System load", x: 1100, y: 220, properties: { resistance: 440 } },
  );
  wire("input", "+", "device", "IN"); wire("input", "-", "uno", "GND");
  wire("device", "BAT_2", "cell", "+"); wire("cell", "-", "uno", "GND");
  wire("device", "OUT_10", "load", "+"); wire("load", "-", "uno", "GND");
  for (const pin of ["VSS", "EP", "CE", "EN1", "EN2"]) wire("device", pin, "uno", "GND");
  for (const [pin, resistance] of [["ISET", 1780], ["ILIM", 1610], ["TS", 10000], ["ITERM", 5000], ["TMR", 46400]] as const) {
    const id = `r-${pin.toLowerCase()}`;
    p.components.push({ id, type: "resistor", label: `${pin} ${resistance} Ω`, x: 250, y: 160 + p.components.length * 36, properties: { resistance } });
    wire("device", pin, id, "1"); wire(id, "2", "uno", "GND");
  }
  p.code = "void setup(){ pinMode(5, OUTPUT); digitalWrite(5, LOW); } void loop(){ digitalWrite(5, LOW); delay(1000); digitalWrite(5, HIGH); delay(250); digitalWrite(5, LOW); delay(1000); }";
  return p;
}
function bq76920Example(): CircuitProject {
  const p = example("bq76920"), { wire } = wiring(p);
  p.components[1].properties = {};
  for (let i = 0; i < 3; i++) {
    const id = `cell${i}`;
    p.components.push({ id, type: "battery-cell", label: `Cell ${i + 1}`, x: 260 + i * 210, y: 240, properties: { initialSoc: 50, capacityMah: 1000, temperature: 25 } });
    if (i) wire(id, "-", `cell${i - 1}`, "+");
    wire("device", `VC${i}`, id, "-"); wire("device", `VC${i + 1}`, id, "+");
  }
  wire("cell0", "-", "uno", "GND"); wire("device", "VC4", "device", "VC3"); wire("device", "VC5", "device", "VC4");
  wire("device", "BAT", "cell2", "+"); wire("device", "REGSRC", "cell2", "+"); wire("device", "VSS", "uno", "GND");
  p.components.push(
    { id: "sense", type: "resistor", label: "10 mΩ current sense", x: 850, y: 280, properties: { resistance: 0.01 } },
    { id: "thermistor", type: "resistor", label: "10 kΩ temperature sense", x: 260, y: -120, properties: { resistance: 10000 } },
    { id: "load", type: "dc-load", label: "Protected 10.8 Ω load", x: 1100, y: 220, properties: { resistance: 10.8 } },
    { id: "switch", type: "ideal-mosfet", label: "Discharge protection switch", x: 1100, y: 0 },
  );
  wire("device", "TS1", "thermistor", "1"); wire("thermistor", "2", "uno", "GND");
  wire("load", "+", "cell2", "+"); wire("load", "-", "switch", "D"); wire("switch", "S", "sense", "1"); wire("sense", "2", "uno", "GND");
  wire("device", "DSG", "switch", "G"); wire("device", "SRP", "sense", "2"); wire("device", "SRN", "sense", "1");
  for (const pin of ["SDA", "SCL"]) {
    wire("device", pin, "uno", pin === "SDA" ? "A4" : "A5");
    const id = `pullup-${pin}`;
    p.components.push({ id, type: "resistor", label: "4.7 kΩ I²C pull-up", x: 250, y: pin === "SDA" ? -220 : -170, properties: { resistance: 4700 } });
    wire("device", pin, id, "1"); wire(id, "2", "uno", "3V3");
  }
  p.code = `#include <bq769x0.h>\nbq769x0 monitor(bq76920,0x08); void setup(){ Serial.begin(9600); monitor.begin(2); monitor.enableDischarging(); } void loop(){ monitor.update(); Serial.println(monitor.getBatteryVoltage()); Serial.println(monitor.getCellVoltage(1)); Serial.println(monitor.getBatteryCurrent()); delay(250); }`;
  return p;
}
export const COMPONENT_EXAMPLES: Readonly<Record<string, () => CircuitProject>> = {
  cd74hc4067: () => muxExample("cd74hc4067"), cd74hc4051: () => muxExample("cd74hc4051"), "74hc138": decoderExample,
  tb6612fng: () => driverExample("tb6612fng"), drv8833: () => driverExample("drv8833"), l298: () => driverExample("l298"),
  bme280: () => i2cSensorExample("bme280"), bmp280: () => i2cSensorExample("bmp280"), "sht31-dis": () => i2cSensorExample("sht31-dis"), ds18b20: oneWireExample,
  dht22: dhtExample, "mpu-6050": imuExample, tca9548a: tcaExample, mcp23017: mcpExample, "74hc595": shiftRegisterExample, rfm95w: loraExample,
  "xbee-s2c-zigbee-th": xbeeExample,
  "bq27441-g1": bq27441Example,
  bq24074: bq24074Example, bq76920: bq76920Example,
  "dc-supply": () => powerPrimitiveExample("dc-supply"), "battery-cell": () => powerPrimitiveExample("battery-cell"),
  "dc-load": () => powerPrimitiveExample("dc-load"), "ideal-mosfet": () => powerPrimitiveExample("ideal-mosfet"),
};
