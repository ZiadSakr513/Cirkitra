import { COMPONENT_CATALOG } from "../lib/circuit/catalog.ts";
import { COMPLEX_RELIABILITY_CASES, type ComplexReliabilityCase } from "./ai-generation-complex-reliability-cases.ts";

export const CATALOG_RELIABILITY_30_SUITE_ID = "catalog-reliability-30-v1" as const;

export type CatalogReliabilityCase = Omit<ComplexReliabilityCase, "category" | "group" | "baseCaseId"> & {
  category: Exclude<ComplexReliabilityCase["category"], "circuit-preserving-edit">;
  group: "single-board" | "multi-board";
  /** Catalog coverage added to the case's primary functional scenario. */
  supplementalComponentTypes: readonly string[];
};

const pin = (componentType: string, ...pins: string[]) => ({ componentType, pins });
const pinLabeled = (componentType: string, labelIncludes: string, ...pins: string[]) => ({ componentType, labelIncludes, pins });

const supplementalByCase: Readonly<Record<string, readonly string[]>> = {
  "complex-sensor-01-climate-oled": ["ground", "lcd-16x2", "sht31-dis"],
  "complex-sensor-02-ambient-light": ["rgb-led", "ws2812b-strip-30"],
  "complex-sensor-03-distance-counter": [],
  "complex-sensor-04-tilt-display": ["ky-040"],
  "complex-sensor-05-gas-alarm": ["toggle-switch", "relay-module-1ch-active-low", "n-mosfet-2n7000"],
  "complex-sensor-06-soil-status": ["neopixel-ring-24", "bh1750-sen0097", "ws2812b-strip-8"],
  "complex-sensor-07-temperature-log": [],
  "complex-sensor-08-co2-monitor": [],
  "complex-robot-01-three-axis-arm": ["servo"],
  "complex-robot-02-ultrasonic-rover": [],
  "complex-robot-03-stepper-indexer": [],
  "complex-robot-04-joystick-stepper": ["74hc595", "74hc138"],
  "complex-robot-05-encoder-servo": [],
  "complex-robot-06-joystick-gimbal": [],
  "complex-multi-01-climate-uart": ["bme280", "bmp280", "mpu-6050"],
  "complex-multi-02-motion-event": ["pir-sensor", "ld2410c-mmwave-radar", "rcwl-0516-microwave-radar"],
  "complex-multi-03-analog-console": ["dip-switch-8", "cd74hc4067", "cd74hc4051", "photoresistor-gl5528", "ntc-thermistor-10k"],
  "complex-multi-04-air-quality": ["rfm95w", "xbee-s2c-zigbee-th"],
  "complex-multi-05-temperature-display": ["ds3231-rtc"],
  "complex-edit-01-climate-mute": [],
  "complex-edit-02-arm-enable": [],
  "complex-edit-03-uart-alert": [],
  "complex-edit-04-temperature-button": [],
  "complex-edit-05-stream-hold": [],
  "complex-power-01-shared-i2c": ["tca9548a", "mcp23017"],
  "complex-power-02-shared-spi-displays": ["tsop4838-ir-receiver", "vs1838b-ir-receiver-module", "ir-remote-controller"],
  "complex-power-03-battery-vin": [],
  "complex-power-04-bme-display": [],
  "complex-power-05-buffered-matrix": ["breadboard-half", "breadboard-full", "logic-and", "logic-or", "logic-xor", "logic-nand", "logic-nor", "logic-not", "ne555-timer", "2n2222-transistor", "pnp-transistor-2n3906", "ws2812b-strip-60"],
  "complex-power-06-external-servo": [],
};

const freshBuildPrompts: Readonly<Record<string, { category: CatalogReliabilityCase["category"]; prompt: string }>> = {
  "complex-edit-01-climate-mute": {
    category: "sensor-control",
    prompt: "Build from scratch an Arduino Uno climate alarm with one DHT11, one SSD1306 I2C OLED, a buzzer, and a normally-open push button. Connect DHT11 DATA directly to D2 and add one 4.7 kOhm pull-up from DATA to 5V; connect VCC to 5V and GND directly to Uno GND. Connect OLED SDA to A4/SDA and SCL to A5/SCL, VCC to 5V, and GND to the same Uno GND. Add separate 4.7 kOhm pull-ups from SDA to 5V and SCL to 5V, labelled OLED SDA Pull-up and OLED SCL Pull-up. Connect buzzer + to D3 and buzzer - directly to Uno GND. Connect push-button terminal 1 to D4 and terminal 2 to the same GND using INPUT_PULLUP. Wire every ground return directly together at Uno GND; do not add ground-symbol components. Use `#include <DHT.h>` with `DHT sensor(2,DHT11); sensor.begin();`, and use `#include <Adafruit_SSD1306.h>` with `Adafruit_SSD1306 display(128,64,&Wire,-1); display.begin(SSD1306_SWITCHCAPVCC,0x3C);`. Each loop, read and print DHT temperature/humidity, clear the OLED, set cursor and text, print both live values, then call display.display(). Sound above 28 C with tone/noTone; edge-detect each button press to toggle persistent mute until temperature recovers below 25 C. Include complete runnable code.",
  },
  "complex-edit-02-arm-enable": {
    category: "robotics-motion",
    prompt: "Build from scratch a three-axis Arduino Uno servo arm with three SG90 servos, one independent potentiometer per joint, an external 5 V servo supply with common ground, and a normally-open master-enable push button on D4 using INPUT_PULLUP. While held, map each knob to its own safe joint angle; immediately command every joint to center at 90 degrees when released. Include correctly powered signal wiring and a complete sketch.",
  },
  "complex-edit-03-uart-alert": {
    category: "multi-board",
    prompt: "Build a compact two-board climate dashboard with one ESP32 DevKit V1 30-pin board, one XIAO ESP32-S3 Sense, one DHT22, one SH1107 OLED, one buzzer, and three 4.7k resistors labeled DHT pull-up, OLED SDA pull-up, and OLED SCL pull-up. On ESP32 connect DHT DATA to GPIO4; wire UART1 GPIO17 TX to XIAO GPIO44 RX and XIAO GPIO43 TX to ESP32 GPIO16 RX. Use Serial1.begin(9600) on both boards; do not use GPIO1/3 or GPIO17/16 as independent GPIO outputs. Wire DHT pull-up between DATA and 3V3. On XIAO connect OLED SDA/SCL to D4/GPIO5 and D5/GPIO6 and wire each named OLED pull-up from that bus line to 3V3. Power sensor/OLED from 3V3. Join all board GND, DHT/OLED/buzzer returns into one common ground net. Connect buzzer + to XIAO D2/GPIO3. ESP32 sends temperature/humidity over crossed UART; XIAO displays them and sounds above 30 C. Keep both complete sketches concise.",
  },
  "complex-edit-04-temperature-button": {
    category: "sensor-control",
    prompt: "Build from scratch an Arduino Nano Classic DS18B20 temperature logger with a 4.7 kOhm pull-up on the D2 one-wire data bus, a resistor-protected alarm LED on D9, and a push button from D3 to ground using INPUT_PULLUP. Wire sensor VDD to 5V and GND directly to the Nano GND pin; connect DQ to D2 and the pull-up, with its other resistor lead at 5V. Wire the LED cathode and button terminal 2 directly to that same Nano GND pin; wire button terminal 1 to D3. Join every ground/return pin to the same Nano GND net and do not add separate ground symbols. Print temperature over Serial, turn on the LED above 32 C, and toggle Celsius/Fahrenheit display units on button presses without changing the alarm threshold. Include complete code and power wiring.",
  },
  "complex-edit-05-stream-hold": {
    category: "multi-board",
    prompt: "Build from scratch a two-board analog console using a Raspberry Pi Pico, an ESP32 NodeMCU-32S, a potentiometer, a push button, and a TM1637 display. Wire Pico GP0 TX directly to ESP32 GPIO3 RX, and ESP32 GPIO1 TX directly to Pico GP1 RX; connect one Pico GND directly to one ESP32 GND. Potentiometer SIG goes to Pico GP26, VCC to 3V3, GND to Pico GND. Connect push-button terminal 1 to Pico GP14 and terminal 2 directly to Pico GND using INPUT_PULLUP. TM1637 CLK/DIO connect to ESP32 GPIO18/GPIO19 and its power to 3V3/GND. Use `Serial.begin(9600)` on both boards for the wired UART0 link; never call `Serial0.begin()` or change the UART pins. The Pico reads the knob and transmits samples over crossed UART; the ESP32 displays the latest value with `display.setBrightness(5)` and `display.showNumberDec(value)`. Each button press toggles hold/resume so the display freezes at the last received value until the next press. Provide separate complete sketches.",
  },
};

const supplementalPromptOverrides: Readonly<Record<string, string>> = {
  "complex-robot-01-three-axis-arm": "Also include one separate generic Servo (not an SG90 substitute), named Auxiliary Servo. Connect its SIG only to Uno D6, VCC to the same regulated external 5 V servo rail, and GND to the common Uno/supply negative. Declare auxiliaryServo and attach it to D6; command it to 90 degrees once. Keep the three SG90 signal wires and their Servo objects exclusively on D9, D10, and D11, respectively.",
  "complex-power-02-shared-spi-displays": "For the shared SPI bus, use D10 only for the TFT CS and D9 only for the MAX7219 CS. Configure both as OUTPUT and drive both HIGH before SPI begins. For each matrix transaction, keep TFT CS HIGH, pull D9 LOW only around its two SPI.transfer bytes, then return D9 HIGH before selecting the TFT. Never leave both chip-select lines LOW during any transfer. Initialize MAX7219 registers 0x0C=1, 0x09=0, 0x0B=7, and 0x0A=3, then write nonzero data to rows 0x01 through 0x08 so the matrix visibly lights.",
};

function expandedPrompt(base: ComplexReliabilityCase, supplemental: readonly string[], promptOverride?: string): string {
  const prompt = promptOverride ?? base.prompt;
  if (!supplemental.length) return prompt;
  const names = supplemental.map(type => COMPONENT_CATALOG[type]?.displayName ?? type);
  return `${prompt}\n\nRequired additional catalog hardware for this same build: ${names.join(", ")}. Include real instances of every named part in the schematic, connect each active device to compatible power, ground, and signal pins, and exercise its supported sketch interface or passive electrical role. They are mandatory; do not omit or substitute them.`;
}

export const CATALOG_RELIABILITY_30_CASES: readonly CatalogReliabilityCase[] = COMPLEX_RELIABILITY_CASES.map(base => {
  const supplementalComponentTypes = supplementalByCase[base.id];
  if (!supplementalComponentTypes) throw new Error(`No catalog coverage assignment for ${base.id}.`);
  const fresh = freshBuildPrompts[base.id];
  const baseCase = base.group === "edit" ? COMPLEX_RELIABILITY_CASES.find(candidate => candidate.id === base.baseCaseId) : undefined;
  const extraRequiredNets = base.id === "complex-edit-01-climate-mute" ? [
    [pin("arduino-uno", "D2"), pinLabeled("resistor", "DHT pull-up", "1")],
    [pinLabeled("resistor", "DHT pull-up", "2"), pin("arduino-uno", "5V")],
    [pin("arduino-uno", "A4"), pinLabeled("resistor", "OLED SDA Pull-up", "1")],
    [pinLabeled("resistor", "OLED SDA Pull-up", "2"), pin("arduino-uno", "5V")],
    [pin("arduino-uno", "A5"), pinLabeled("resistor", "OLED SCL Pull-up", "1")],
    [pinLabeled("resistor", "OLED SCL Pull-up", "2"), pin("arduino-uno", "5V")],
  ] : base.id === "complex-edit-03-uart-alert" ? [
    [pin("esp32-devkit-v1-30pin", "GPIO4"), pinLabeled("resistor", "DHT pull-up", "1")],
    [pinLabeled("resistor", "DHT pull-up", "2"), pin("esp32-devkit-v1-30pin", "3V3")],
    [pin("xiao-esp32s3-sense", "D4", "GPIO5"), pinLabeled("resistor", "OLED SDA pull-up", "1")],
    [pinLabeled("resistor", "OLED SDA pull-up", "2"), pin("xiao-esp32s3-sense", "3V3")],
    [pin("xiao-esp32s3-sense", "D5", "GPIO6"), pinLabeled("resistor", "OLED SCL pull-up", "1")],
    [pinLabeled("resistor", "OLED SCL pull-up", "2"), pin("xiao-esp32s3-sense", "3V3")],
  ] : [];
  const baseRequiredNets = baseCase
    ? base.id === "complex-edit-03-uart-alert"
      ? [
        [pin("esp32-devkit-v1-30pin", "GPIO17"), pin("xiao-esp32s3-sense", "D7", "GPIO44")],
        [pin("xiao-esp32s3-sense", "D6", "GPIO43"), pin("esp32-devkit-v1-30pin", "GPIO16")],
        ...baseCase.requiredNets.slice(2),
      ]
      : baseCase.requiredNets
    : [];
  const requiredNets = baseCase ? [...baseRequiredNets, ...base.requiredNets, ...extraRequiredNets] : [...base.requiredNets, ...extraRequiredNets];
  const prompt = expandedPrompt(base, supplementalComponentTypes, fresh?.prompt);
  const supplement = supplementalPromptOverrides[base.id];
  const expectedComponentTypes = [...new Set([
    ...base.expectedComponentTypes,
    ...(base.id === "complex-sensor-03-distance-counter" ? ["seven-segment"] : []),
    ...(base.id === "complex-edit-01-climate-mute" ? ["resistor"] : []),
    ...(base.id === "complex-edit-03-uart-alert" ? ["resistor"] : []),
    ...supplementalComponentTypes,
  ])];
  const category = fresh?.category ?? (base.category === "circuit-preserving-edit" ? "sensor-control" : base.category);
  const group = base.group === "edit"
    ? (base.expectedBoardTypes.length > 1 ? "multi-board" : "single-board")
    : base.group;
  const withoutBaseCase = { ...base };
  delete withoutBaseCase.baseCaseId;
  return {
    ...withoutBaseCase,
    category,
    group,
    prompt: supplement ? `${prompt}\n\n${supplement}` : prompt,
    expectedComponentTypes,
    requiredNets,
    supplementalComponentTypes,
  };
});

export function missingCatalogCoverage(cases: readonly CatalogReliabilityCase[] = CATALOG_RELIABILITY_30_CASES): string[] {
  const covered = new Set(cases.flatMap(testCase => testCase.expectedComponentTypes));
  return Object.keys(COMPONENT_CATALOG).filter(type => !covered.has(type)).sort();
}
