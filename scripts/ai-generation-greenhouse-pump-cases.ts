export const GREENHOUSE_PUMP_SUITE_ID = "greenhouse-pump-v1";

export type GreenhousePumpCase = {
  id: string;
  group: "single-board";
  prompt: string;
  minimumBoards: 1;
  expectedComponentTypes: readonly string[];
  verification: "greenhouse" | "pump-continuous" | "pump-toggle" | "pump-dry-default" | "pump-dry-explicit" | "pump-hold" | "esp32-pump" | "pixel-buffer";
};

/** Live regression prompts for the R385/greenhouse repair and behavior contract. */
export const GREENHOUSE_PUMP_CASES: readonly GreenhousePumpCase[] = [
  {
    id: "greenhouse-repro",
    group: "single-board",
    minimumBoards: 1,
    verification: "greenhouse",
    expectedComponentTypes: ["arduino-uno", "soil-moisture-sen0193", "bme280-gy-bme-p280", "ssd1306-oled-128x64", "relay-module-1ch-active-low", "r385-water-pump", "dc-supply"],
    prompt: "Build an Arduino Uno greenhouse controller with a SEN0193 soil sensor, a BME280 GY-BME/P280 climate sensor breakout, an SSD1306 OLED, an active-low relay, and an R385 pump. Convert soil readings with moisturePercent = 100 - analogRead(A0) * 100 / 1023. Start the pump when soil moisture falls below 35%, and stop it after moisture recovers 5 percentage points above that threshold. Use a compatible 9 V supply switched only through relay COM and NO; connect pump negative to the same supply negative and share ground with the Uno. Show moisture and climate readings on the OLED.",
  },
  {
    id: "pump-compatible-supply",
    group: "single-board",
    minimumBoards: 1,
    verification: "pump-continuous",
    expectedComponentTypes: ["arduino-uno", "relay-module-1ch-active-low", "r385-water-pump", "dc-supply"],
    prompt: "Build an Arduino Uno pump test with an R385 water pump, an active-low relay module, and a 9 V DC supply. After setup, run the pump continuously by energizing the relay. Connect supply positive to COM, NO to pump positive, and pump negative to the same supply negative; share the return with the Uno. Do not power the pump from a GPIO.",
  },
  {
    id: "pump-toggle",
    group: "single-board",
    minimumBoards: 1,
    verification: "pump-toggle",
    expectedComponentTypes: ["arduino-uno", "relay-module-1ch-active-low", "r385-water-pump", "push-button", "dc-supply"],
    prompt: "Build an Arduino Uno watering switch with a push button, an active-low relay, and an R385 pump. Every press must toggle the pump state, and the state must remain changed after release; a second press must toggle it back. Use an active-low INPUT_PULLUP button with edge detection. Power the R385 through relay COM/NO from a 9 V supply, with the pump negative returning to the supply negative and common ground to the Uno.",
  },
  {
    id: "pump-dry-default",
    group: "single-board",
    minimumBoards: 1,
    verification: "pump-dry-default",
    expectedComponentTypes: ["arduino-uno", "soil-moisture-sen0193", "relay-module-1ch-active-low", "r385-water-pump", "dc-supply"],
    prompt: "Build an Arduino Uno automatic plant-watering controller with a SEN0193 soil-moisture sensor and an R385 pump switched by an active-low relay. Measure moisture as 100 - analogRead(A0) * 100 / 1023. Start the pump when the soil is dry; keep watering until moisture rises 5 percentage points above that threshold. Use the standard dry-soil default; do not choose a different numeric threshold. Use a compatible 9 V pump supply through COM and NO, and connect pump negative to that supply's negative terminal with a common ground.",
  },
  {
    id: "pump-dry-explicit-threshold",
    group: "single-board",
    minimumBoards: 1,
    verification: "pump-dry-explicit",
    expectedComponentTypes: ["arduino-uno", "soil-moisture-sen0193", "relay-module-1ch-active-low", "r385-water-pump", "dc-supply"],
    prompt: "Build an Arduino Uno irrigation controller using a SEN0193 capacitive soil sensor, one active-low relay, and an R385 pump. Convert the raw ADC count to moisture percent with 100 - analogRead(A0) * 100 / 1023. Start the pump when soil moisture falls below 42%, and stop it after moisture rises 5 percentage points above that threshold. The pump supply is a 9 V source wired positive to COM, NO to pump +, and pump - to source -, with common ground.",
  },
  {
    id: "pump-while-held",
    group: "single-board",
    minimumBoards: 1,
    verification: "pump-hold",
    expectedComponentTypes: ["arduino-uno", "relay-module-1ch-active-low", "r385-water-pump", "push-button", "dc-supply"],
    prompt: "Build an Arduino Uno manual pump control with a push button, active-low relay, R385 pump, and 9 V pump supply. The pump should run only while the button is held and stop as soon as the button is released; do not latch or toggle it. Use INPUT_PULLUP, wire one button terminal to a digital input and the other to GND, and route the pump supply through relay COM/NO with a shared return.",
  },
  {
    id: "esp32-devkit-pump",
    group: "single-board",
    minimumBoards: 1,
    verification: "esp32-pump",
    expectedComponentTypes: ["esp32-devkit-v1-30pin", "relay-module-1ch-active-low", "r385-water-pump", "dc-supply"],
    prompt: "Use an ESP32 DevKit V1 30-pin board to build a moisture-triggered R385 pump controller with a SEN0193 sensor, active-low relay, and pump supply. Read the sensor on a valid ADC GPIO. Start the R385 pump when soil moisture falls below 40%, and stop it after moisture recovers 5 percentage points above that threshold. Use a dedicated compatible 9 V supply, wire positive through COM and NO to the pump, return pump negative to the supply negative, and share ground with the ESP32. Never power the pump from an ESP32 pin.",
  },
  {
    id: "esp32-neopixel-buffer",
    group: "single-board",
    minimumBoards: 1,
    verification: "pixel-buffer",
    expectedComponentTypes: ["esp32-nodemcu-32s", "ws2812b-strip-8", "sn74ahct1g125"],
    prompt: "Build an ESP32 NodeMCU-32S circuit that drives an 8-pixel WS2812B strip through an SN74AHCT1G125 buffer. Use one valid ESP32 GPIO for both the Adafruit_NeoPixel data pin and the buffer A input; connect buffer Y to strip DIN, OE to GND, and power the buffer and strip from 5 V. Share all grounds and include the recommended series data resistor. The sketch should initialize the strip and visibly display a green chase pattern.",
  },
];
