import { COMPONENT_EXAMPLES } from "../../lib/circuit/component-examples.ts";
import type { CircuitProject } from "../../lib/circuit/types.ts";

export const greenhousePrompt = `Build a simulation-ready dual-zone greenhouse vent controller. Use one Arduino Uno, one TCA9548A, two BME280 sensors with the same I2C address, one MCP23017, one TB6612FNG, one DC motor as the ventilation fan, one adjustable DC supply for the motor, three LEDs, and three 220 ohm resistors.
Connect the Uno SDA and SCL to the TCA9548A and MCP23017. Put one BME280 on TCA channel 0 and the other on channel 1, so the identical sensor addresses do not conflict. Power the sensors and mux within their rated voltage, connect all grounds, and configure each BME280 for I2C. Select each mux channel before reading that sensor, then read and print its temperature, humidity, and pressure.
Use the MCP23017 at address 0x20 to control three indicator LEDs through their resistors. Turn on the first LED when the west zone exceeds 28 C, the second when the east zone exceeds 28 C, and the third when either zone exceeds 32 C.
Drive the fan through motor channel A of the TB6612FNG. Use Uno pins D6 and D7 for direction, D5 for PWM, and D8 for STBY. Power VM from the adjustable DC supply, VCC from the Uno logic supply, and join grounds. Run the fan forward at 75% when the average temperature is at least 30 C, and stop it below 27 C.
Keep the wiring organized and labeled. Make the two sensor readings, LED outputs, and motor activity respond to the running sketch. If a sensor is unpowered or unavailable, report that in Serial and keep the fan stopped. Use only simulator-supported components and library calls.`;

/** Integration fixture, never a fallback for generated content. */
export function greenhouseExample(): CircuitProject {
  const p = structuredClone(COMPONENT_EXAMPLES.tca9548a());
  p.id = "greenhouse-integration"; p.name = "Dual-zone greenhouse";
  const west = p.components.find(c => c.id === "sensor")!;
  west.type = "bme280"; west.properties = { temperature: 34, pressure: 101325, humidity: 50 };
  const wire = (a: string, pin: string, b: string, other: string) => p.connections.push({ id: `greenhouse-${p.connections.length}`, from: { componentId: a, pin }, to: { componentId: b, pin: other } });
  p.components.push({ ...west, id: "east", label: "East sensor", y: 500, properties: { ...west.properties, temperature: 30 } });
  for (const w of p.connections.filter(w => w.from.componentId === "sensor")) {
    if (w.to.componentId.startsWith("downstream-")) continue;
    wire("east", w.from.pin, w.to.componentId, w.to.componentId === "device" ? w.to.pin.replace("0", "1") : w.to.pin);
  }
  for (const pin of ["SDI", "SCK"]) {
    const id = `east-pullup-${pin}`;
    p.components.push({ id, type: "resistor", label: "4.7k pull-up", x: 700, y: 500, properties: { resistance: 4700 } });
    wire("east", pin, id, "1"); wire(id, "2", "uno", "3V3");
  }
  const merge = (other: CircuitProject, prefix: string) => {
    const id = (name: string) => name === "uno" ? name : prefix + name;
    for (const c of other.components.filter(c => c.id !== "uno")) p.components.push({ ...c, id: id(c.id), y: c.y + 1000 });
    for (const w of other.connections) wire(id(w.from.componentId), w.from.pin, id(w.to.componentId), w.to.pin);
  };
  merge(COMPONENT_EXAMPLES.mcp23017(), "io-");
  const driver = COMPONENT_EXAMPLES.tb6612fng();
  driver.components = driver.components.filter(c => c.id !== "motor-b");
  driver.connections = driver.connections.filter(w => w.from.componentId !== "motor-b" && w.to.componentId !== "motor-b");
  for (const w of driver.connections) {
    if (w.from.componentId === "device" && w.to.componentId === "uno") {
      const controls: Record<string, string> = { AIN1: "D6", AIN2: "D7", STBY: "D8" };
      if (controls[w.from.pin]) w.to.pin = controls[w.from.pin];
      if (w.from.pin.startsWith("VM")) w.to = { componentId: "supply", pin: "+" };
    }
  }
  driver.components.push({ id: "supply", type: "dc-supply", label: "6V motor supply", x: 600, y: 800, properties: { voltage: 6, enabled: true } });
  driver.connections.push({ id: "supply-ground", from: { componentId: "supply", pin: "-" }, to: { componentId: "uno", pin: "GND" } });
  merge(driver, "fan-");
  for (let i = 1; i < 3; i++) {
    p.components.push({ id: `led-${i}`, type: "led", label: `Indicator ${i}`, x: 1200, y: 800 + i * 150 }, { id: `res-${i}`, type: "resistor", label: "220 ohm", x: 1000, y: 800 + i * 150, properties: { resistance: 220 } });
    wire("io-device", `GPA${i}`, `res-${i}`, "1"); wire(`res-${i}`, "2", `led-${i}`, "A"); wire(`led-${i}`, "K", "uno", "GND");
  }
  p.code = `#include <TCA9548.h>
#include <Adafruit_BME280.h>
#include <Adafruit_MCP23X17.h>
TCA9548 mux(0x70);
Adafruit_BME280 west;
Adafruit_BME280 east;
Adafruit_MCP23X17 io;
bool westOk = false;
bool eastOk = false;
bool fan = false;
void setup(){
  Serial.begin(9600);
  pinMode(5, OUTPUT); pinMode(6, OUTPUT); pinMode(7, OUTPUT); pinMode(8, OUTPUT);
  digitalWrite(6, HIGH); digitalWrite(7, LOW); digitalWrite(8, HIGH); analogWrite(5, 0);
  mux.begin(); mux.selectChannel(0); westOk = west.begin(0x76);
  mux.selectChannel(1); eastOk = east.begin(0x76); mux.closeAll();
  io.begin_I2C(0x20); io.pinMode(0, OUTPUT); io.pinMode(1, OUTPUT); io.pinMode(2, OUTPUT);
  delay(20);
}
void loop(){
  mux.selectChannel(0); float w = west.readTemperature(); Serial.println(w); Serial.println(west.readHumidity()); Serial.println(west.readPressure());
  mux.selectChannel(1); float e = east.readTemperature(); Serial.println(e); Serial.println(east.readHumidity()); Serial.println(east.readPressure()); mux.closeAll();
  if (!westOk || !eastOk || isnan(w) || isnan(e)) { fan = false; Serial.println("Sensor unavailable"); }
  else { float average = (w + e) / 2; if (average >= 30) { fan = true; } else if (average < 27) { fan = false; } }
  io.digitalWrite(0, w > 28); io.digitalWrite(1, e > 28); io.digitalWrite(2, w > 32 || e > 32);
  if (fan) { analogWrite(5, 191); } else { analogWrite(5, 0); }
  delay(500);
}`;
  return p;
}
