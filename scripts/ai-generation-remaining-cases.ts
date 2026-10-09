export type RemainingComponentCase = {
  id: string;
  group: "component-coverage";
  prompt: string;
  minimumBoards: number;
  expectedComponentTypes: readonly string[];
};

/** Versioned live-generation prompts for the 36 catalog types missing from
 * the original reliability run. Each case exercises one coherent circuit;
 * expected types are asserted against the final validated route response. */
export const REMAINING_COMPONENT_SUITE_ID = "remaining-components-v1" as const;

export const REMAINING_COMPONENT_CASES: readonly RemainingComponentCase[] = [
  {
    id: "component-01-nano-rgb",
    group: "component-coverage",
    minimumBoards: 1,
    expectedComponentTypes: ["arduino-nano-classic", "rgb-led"],
    prompt: "Build a complete Arduino Nano Classic RGB status lamp. Use one common-cathode RGB LED with a separate current-limiting resistor on each color, fade smoothly through red, green, and blue using three PWM outputs, and include the complete executable sketch.",
  },
  {
    id: "component-02-decoder",
    group: "component-coverage",
    minimumBoards: 1,
    expectedComponentTypes: ["74hc138"],
    prompt: "Build an Arduino Uno one-of-eight output selector using a 74HC138 3-to-8 decoder and eight LEDs, each with its own current-limiting resistor. Cycle the three address inputs so exactly the selected active-low output lights; wire all enable pins to their active states and include a complete sketch.",
  },
  {
    id: "component-03-shift-register",
    group: "component-coverage",
    minimumBoards: 1,
    expectedComponentTypes: ["74hc595"],
    prompt: "Build an Arduino Uno eight-LED chaser driven by a 74HC595 shift register. Wire data, shift clock, latch, output-enable, and reset correctly; include a resistor for each LED and a complete sketch that shifts a walking-one pattern through all eight outputs.",
  },
  {
    id: "component-04-mux-4051",
    group: "component-coverage",
    minimumBoards: 1,
    expectedComponentTypes: ["cd74hc4051"],
    prompt: "Build an Arduino Uno analog input selector with a CD74HC4051 8-channel analog multiplexer. Connect its common pin to A0, connect three selector pins to distinct GPIOs, set inhibit and supply pins correctly, and have the sketch scan the channels and print each analog value.",
  },
  {
    id: "component-05-mux-4067",
    group: "component-coverage",
    minimumBoards: 1,
    expectedComponentTypes: ["cd74hc4067"],
    prompt: "Build an Arduino Uno 16-channel analog scanner using a CD74HC4067 multiplexer. Connect SIG to A0, all four address pins to distinct GPIOs, EN to its enabled level, and the supply and ground correctly. Include a complete sketch that scans all 16 channels and prints the selected channel and reading.",
  },
  {
    id: "component-06-gpio-expander",
    group: "component-coverage",
    minimumBoards: 1,
    expectedComponentTypes: ["mcp23017"],
    prompt: "Build an Arduino Uno I2C output-expander demo using an MCP23017 and an LED with a current-limiting resistor on GPA0. Wire SDA/SCL, address straps, reset, supply, and ground; include a complete sketch that initializes address 0x20 and blinks the expander output.",
  },
  {
    id: "component-07-i2c-environment",
    group: "component-coverage",
    minimumBoards: 1,
    expectedComponentTypes: ["tca9548a", "bmp280", "sht31-dis", "temperature-sensor"],
    prompt: "Build an Arduino Uno environmental logger with a TCA9548A I2C multiplexer, a BMP280 and an SHT31 on separate mux channels, plus a separate analog temperature sensor on A0. Wire the two digital sensors to distinct downstream channels, provide correct power/address/bus wiring, and write a complete sketch that selects each channel before reading and reports all three temperatures.",
  },
  {
    id: "component-08-logic-and-nand",
    group: "component-coverage",
    minimumBoards: 1,
    expectedComponentTypes: ["logic-and", "logic-nand"],
    prompt: "Build a truth-table demonstrator using an AND logic gate and a NAND logic gate with two shared input switches and separate output LEDs with resistors. Connect the inputs and outputs so the two outputs show their distinct truth-table results; use an Arduino Uno sketch to cycle all four input combinations and print them.",
  },
  {
    id: "component-09-logic-nor-not",
    group: "component-coverage",
    minimumBoards: 1,
    expectedComponentTypes: ["logic-nor", "logic-not"],
    prompt: "Build an Arduino Uno logic demo with a NOR gate and a NOT gate, one shared digital input, and separate output LEDs with resistors. Wire each gate output observably and cycle the input low/high in a complete sketch while printing the expected NOR and inverted states.",
  },
  {
    id: "component-10-logic-or-xor",
    group: "component-coverage",
    minimumBoards: 1,
    expectedComponentTypes: ["logic-or", "logic-xor"],
    prompt: "Build a two-input truth-table demo using OR and XOR logic gates, two Arduino Uno digital inputs, and one resistor-protected LED on each gate output. Cycle all four input combinations in a complete sketch and print the OR and XOR results so their different 1,1 behavior is visible.",
  },
  {
    id: "component-11-stepper",
    group: "component-coverage",
    minimumBoards: 1,
    expectedComponentTypes: ["a4988-stepper-driver", "bipolar-stepper-motor"],
    prompt: "Build an Arduino Uno bipolar stepper positioning demo using an A4988 stepper driver and a bipolar stepper motor. Wire STEP, DIR, ENABLE, motor coils, motor supply, logic supply, grounds, and microstep straps correctly; include a complete sketch that moves the motor forward and back with safe step pulses.",
  },
  {
    id: "component-12-drv8833-power-load",
    group: "component-coverage",
    minimumBoards: 1,
    expectedComponentTypes: ["drv8833", "dc-supply", "dc-load"],
    prompt: "Build an Arduino Uno switched-load demo using a DRV8833 motor driver, a DC supply, and a DC load. Use one H-bridge channel to control the load, connect VM, logic power, grounds, sleep, and both output terminals correctly, and provide a complete sketch that drives the load on then off.",
  },
  {
    id: "component-13-l298-battery",
    group: "component-coverage",
    minimumBoards: 1,
    expectedComponentTypes: ["l298", "battery-cell"],
    prompt: "Build a minimal Arduino Uno L298 motor controller with one DC motor across OUT1/OUT2. Power both L298 VS and VSS from the Uno regulated 5V rail, which is within both supply ranges; connect L298 GND and both SENSE pins to common ground. Include one Li-ion battery cell in a separate closed loop with a 100 ohm DC load: cell + to load +, and cell - to load -, with cell negative joined to common ground. Keep the battery cell positive isolated from both L298 supply pins. Drive IN1, IN2, and ENA from distinct GPIOs and run the motor forward, then reverse. Keep the circuit minimal.",
  },
  {
    id: "component-14-tb6612-mosfet",
    group: "component-coverage",
    minimumBoards: 1,
    expectedComponentTypes: ["tb6612fng", "ideal-mosfet"],
    prompt: "Build an Arduino Uno actuator power-control demo with a TB6612FNG driving a DC motor and an ideal MOSFET switching a separate DC load. Connect the driver's VCC, VM, grounds, STBY, direction and PWM pins, and wire the MOSFET gate to a distinct GPIO; include a complete sketch that independently toggles the motor and switched load.",
  },
  {
    id: "component-15-charger-gauge",
    group: "component-coverage",
    minimumBoards: 1,
    expectedComponentTypes: ["bq24074", "bq27441-g1"],
    prompt: "Build a concise Arduino Uno single-cell charger and fuel-gauge demo with exactly one BQ24074, one battery-cell, and one BQ27441-G1. Connect a 5 V supply to charger IN, charger BAT_2/BAT_3 and gauge BAT to cell positive, and charger OUT to a small DC load. Place a 10 mΩ shunt between cell negative and common ground; connect gauge SRP to the cell side and SRN to the ground side. Ground charger VSS/EP and gauge VSS/EP; connect gauge BIN to ground through 10 kΩ. Add the minimum resistors needed to configure the charger (ISET 1.78 kΩ, ILIM 1.61 kΩ, TS 10 kΩ, ITERM 5 kΩ, TMR 46.4 kΩ) and 4.7 kΩ pull-ups from SDA/SCL to Uno 3V3; connect SDA/SCL to A4/A5. Use a short sketch to initialize the gauge and print voltage and state of charge. Keep the component list and explanation concise.",
  },
  {
    id: "component-16-battery-monitor",
    group: "component-coverage",
    minimumBoards: 1,
    expectedComponentTypes: ["bq76920", "battery-cell", "ideal-mosfet"],
    prompt: "Build an Arduino Uno protected battery-discharge monitor using a BQ76920, three battery-cell components, and an ideal MOSFET as the switched load disconnect. Connect the cell-sense inputs in order, supply and ground pins, I2C bus, and gate control; include a complete sketch that reads the monitor and enables the discharge switch only when the pack is healthy.",
  },
  {
    id: "component-17-pir-display",
    group: "component-coverage",
    minimumBoards: 1,
    expectedComponentTypes: ["pir-sensor", "seven-segment"],
    prompt: "Build an Arduino Uno occupancy counter using a PIR sensor and a seven-segment display. Wire the sensor output and every display segment through a current-limiting resistor, then include a complete sketch that increments the displayed count once per motion event with a short re-arm interval.",
  },
  {
    id: "component-18-esp8266-temperature",
    group: "component-coverage",
    minimumBoards: 1,
    expectedComponentTypes: ["esp8266-nodemcu-v1", "temperature-sensor"],
    prompt: "Build a NodeMCU ESP8266 temperature alarm with an analog temperature sensor on A0, a resistor-protected status LED, and a buzzer. Use only safe ESP8266 pins and the board's supported analog input; include a complete sketch that reports temperature and activates the alarm above 30 C with hysteresis.",
  },
  {
    id: "component-19-rfid-sd-log",
    group: "component-coverage",
    minimumBoards: 1,
    expectedComponentTypes: ["mfrc522-rfid-module", "micro-sd-spi-module"],
    prompt: "Build an ESP32 DevKit RFID access-event logger using its native 3.3-V GPIO with an MFRC522 module, a MicroSD SPI module, and a status LED with resistor. Share SPI clock/MOSI/MISO, use separate chip-select pins, wire reset and 3.3 V supplies safely, and include a complete sketch that logs each scanned tag UID and indicates a scan on the LED.",
  },
  {
    id: "component-20-radio-links",
    group: "component-coverage",
    minimumBoards: 1,
    expectedComponentTypes: ["rfm95w", "xbee-s2c-zigbee-th"],
    prompt: "Build an Arduino Uno wireless telemetry gateway with an RFM95W LoRa radio and an XBee S2C Zigbee module. Connect the RFM95W on SPI and its reset/interrupt pins, connect the XBee on a separate UART, provide each module's correct 3.3 V supply and common ground, and include a complete sketch that sends a status message through each radio interface.",
  },
];
