export const COMPLEX_RELIABILITY_SUITE_ID = "complex-reliability-30-v1";

export type ComplexReliabilityCategory =
  | "sensor-control"
  | "robotics-motion"
  | "multi-board"
  | "circuit-preserving-edit"
  | "power-bus-display";

export type ComplexPinExpectation = {
  componentType: string;
  /** Accept the physical header name and documented Arduino/GPIO aliases. */
  pins: readonly string[];
  occurrence?: number;
  /** Select a repeated component by a stable fragment of its descriptive label. */
  labelIncludes?: string;
};

export type ComplexBehaviorExpectation = {
  description: string;
  /** Every pattern must be present in the generated board sketches. */
  requiredSketchPatterns: readonly string[];
  evidence: "serial" | "display" | "matrix" | "matrix-and-spi-display" | "joystick-stepper" | "stepper-indexer" | "servo" | "pixels" | "motor" | "tone" | "range-buzzer" | "digital-output" | "any-visible";
};

export type ComplexReliabilityCase = {
  id: string;
  category: ComplexReliabilityCategory;
  group: "single-board" | "multi-board" | "edit";
  prompt: string;
  expectedBoardTypes: readonly string[];
  expectedComponentTypes: readonly string[];
  minimumBoards: number;
  /** Every listed endpoint must resolve to the same electrical net. */
  requiredNets: readonly (readonly ComplexPinExpectation[])[];
  behavior: ComplexBehaviorExpectation;
  baseCaseId?: string;
};

const pin = (componentType: string, ...pins: string[]): ComplexPinExpectation => ({ componentType, pins });
const pinAt = (componentType: string, occurrence: number, ...pins: string[]): ComplexPinExpectation => ({ componentType, occurrence, pins });
const pinLabeled = (componentType: string, labelIncludes: string, ...pins: string[]): ComplexPinExpectation => ({ componentType, labelIncludes, pins });

/**
 * New, versioned reliability scenarios. They intentionally avoid reusing the
 * wording and exact hardware/behavior combinations of the existing 20-case,
 * component-expansion, and greenhouse suites. Edits follow their source build.
 */
export const COMPLEX_RELIABILITY_CASES: readonly ComplexReliabilityCase[] = [
  // 8 sensor/control builds
  {
    id: "complex-sensor-01-climate-oled", category: "sensor-control", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["arduino-uno"], expectedComponentTypes: ["arduino-uno", "dht11", "ssd1306-oled-128x64", "buzzer"],
    prompt: "Build an Arduino Uno room-climate alert with one DHT11, one SSD1306 I2C OLED, and a buzzer. Wire DHT11 DATA to D2 with a 4.7–10 kOhm pull-up from DATA to 5V, VCC to Uno 5V, and GND to Uno GND; wire OLED SDA/SCL to Uno SDA/SCL and power it from a compatible 3.3–5 V rail with common ground. Wire buzzer + to Uno D3 and buzzer - directly to Uno GND (not to an isolated ground symbol). Read temperature and humidity without blocking, show both values on the OLED, and sound the buzzer only above 28 C. Include complete runnable code.",
    requiredNets: [[pin("arduino-uno", "D2"), pin("dht11", "DATA")], [pin("arduino-uno", "5V"), pin("dht11", "VCC")], [pin("arduino-uno", "5V", "3V3"), pin("ssd1306-oled-128x64", "VCC")], [pin("arduino-uno", "GND", "GND2", "GND3"), pin("dht11", "GND"), pin("ssd1306-oled-128x64", "GND"), pin("buzzer", "-")], [pin("arduino-uno", "SDA", "A4"), pin("ssd1306-oled-128x64", "SDA")], [pin("arduino-uno", "SCL", "A5"), pin("ssd1306-oled-128x64", "SCL")], [pin("arduino-uno", "D3"), pin("buzzer", "+")]],
    behavior: { description: "Show live climate readings and apply the requested 28 C buzzer threshold.", requiredSketchPatterns: ["DHT", "digitalWrite|tone|noTone", "28"], evidence: "display" },
  },
  {
    id: "complex-sensor-02-ambient-light", category: "sensor-control", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["esp32-devkit-v1-30pin"], expectedComponentTypes: ["esp32-devkit-v1-30pin", "veml7700-light-sensor", "sh1107-oled-128x128", "led", "resistor"],
    prompt: "Use the 30-pin ESP32 DevKit V1 to make an ambient-light status instrument with exactly one light sensor, a VEML7700 lux sensor, an SH1107 128x128 I2C OLED, and a red indicator LED with its series resistor. Do not add a BH1750 or any other sensor. Put both I2C devices on GPIO21 SDA and GPIO22 SCL, power the sensor and OLED from 3V3 with common ground, and drive the LED from GPIO18 through the component labeled LED Resistor. Display lux and turn on the LED below 80 lux; generate complete code.",
    requiredNets: [[pin("esp32-devkit-v1-30pin", "GPIO21"), pin("veml7700-light-sensor", "SDA"), pin("sh1107-oled-128x128", "SDA")], [pin("esp32-devkit-v1-30pin", "GPIO22"), pin("veml7700-light-sensor", "SCL"), pin("sh1107-oled-128x128", "SCL")], [pin("esp32-devkit-v1-30pin", "3V3"), pin("veml7700-light-sensor", "VIN"), pin("sh1107-oled-128x128", "VCC")], [pin("esp32-devkit-v1-30pin", "GND", "GND2"), pin("veml7700-light-sensor", "GND"), pin("sh1107-oled-128x128", "GND"), pin("led", "K")], [pin("esp32-devkit-v1-30pin", "GPIO18"), pinLabeled("resistor", "LED Resistor", "1")], [pinLabeled("resistor", "LED Resistor", "2"), pin("led", "A")]],
    behavior: { description: "Display lux and switch the indicator at the requested low-light threshold.", requiredSketchPatterns: ["VEML|lux|Wire", "80", "digitalWrite"], evidence: "display" },
  },
  {
    id: "complex-sensor-03-distance-counter", category: "sensor-control", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["arduino-mega-2560"], expectedComponentTypes: ["arduino-mega-2560", "hc-sr04", "tm1637-4-digit-display", "seven-segment", "buzzer", "resistor"],
    prompt: "Create a compact Arduino Mega 2560 distance warning with exactly one HC-SR04, one TM1637 display, one common-cathode seven-segment display, and one buzzer. Wire HC-SR04 TRIG/ECHO to D6/D7, TM1637 CLK/DIO to D8/D9, buzzer + to D10, and all grounds/power to Mega 5V/GND. Wire seven-segment COM to GND; connect A,B,C,D,E,F,G,DP through eight separate 220-ohm resistors labeled A resistor, B resistor, C resistor, D resistor, E resistor, F resistor, G resistor, DP resistor to D22-D29 respectively. Configure D22-D29 as outputs. Every 100 ms, read distanceCm and show its number on TM1637. When distanceCm is between 1 and 100 cm, turn all eight segments on with HIGH; otherwise turn all eight off with LOW. Beep only inside that range with tone(D10,1000), and call noTone(D10) otherwise. Use millis(), concise code, no unnecessary comments or duplicate parts; provide the complete sketch.",
    requiredNets: [[pin("arduino-mega-2560", "D6"), pin("hc-sr04", "TRIG")], [pin("arduino-mega-2560", "D7"), pin("hc-sr04", "ECHO")], [pin("arduino-mega-2560", "D8"), pin("tm1637-4-digit-display", "CLK")], [pin("arduino-mega-2560", "D9"), pin("tm1637-4-digit-display", "DIO")], [pin("arduino-mega-2560", "D10"), pin("buzzer", "+")], [pin("arduino-mega-2560", "D22"), pinLabeled("resistor", "A resistor", "1")], [pinLabeled("resistor", "A resistor", "2"), pin("seven-segment", "A")], [pin("arduino-mega-2560", "D23"), pinLabeled("resistor", "B resistor", "1")], [pinLabeled("resistor", "B resistor", "2"), pin("seven-segment", "B")], [pin("arduino-mega-2560", "D24"), pinLabeled("resistor", "C resistor", "1")], [pinLabeled("resistor", "C resistor", "2"), pin("seven-segment", "C")], [pin("arduino-mega-2560", "D25"), pinLabeled("resistor", "D resistor", "1")], [pinLabeled("resistor", "D resistor", "2"), pin("seven-segment", "D")], [pin("arduino-mega-2560", "D26"), pinLabeled("resistor", "E resistor", "1")], [pinLabeled("resistor", "E resistor", "2"), pin("seven-segment", "E")], [pin("arduino-mega-2560", "D27"), pinLabeled("resistor", "F resistor", "1")], [pinLabeled("resistor", "F resistor", "2"), pin("seven-segment", "F")], [pin("arduino-mega-2560", "D28"), pinLabeled("resistor", "G resistor", "1")], [pinLabeled("resistor", "G resistor", "2"), pin("seven-segment", "G")], [pin("arduino-mega-2560", "D29"), pinLabeled("resistor", "DP resistor", "1")], [pinLabeled("resistor", "DP resistor", "2"), pin("seven-segment", "DP")], [pin("arduino-mega-2560", "5V"), pin("hc-sr04", "VCC"), pin("tm1637-4-digit-display", "VCC")], [pin("arduino-mega-2560", "GND", "GND2", "GND3", "GND4"), pin("hc-sr04", "GND"), pin("tm1637-4-digit-display", "GND"), pin("buzzer", "-"), pin("seven-segment", "COM")]],
    behavior: { description: "Display measured range, sound a distance-dependent warning when near, and remain silent when far.", requiredSketchPatterns: ["pulseIn|pulseInLong", "distance|centimeter|cm", "millis|interval", "digitalWrite|tone|noTone"], evidence: "range-buzzer" },
  },
  {
    id: "complex-sensor-04-tilt-display", category: "sensor-control", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["raspberry-pi-pico"], expectedComponentTypes: ["raspberry-pi-pico", "mpu-6050-breakout", "ssd1306-oled-128x64"],
    prompt: "Build a Raspberry Pi Pico tilt monitor with one MPU-6050 breakout and one SSD1306 I2C OLED. Use the Pico's GP4/GP5 I2C bus for SDA/SCL, power both modules from 3V3, and connect their grounds to Pico GND. Read accelerometer tilt, show signed X/Y tilt values, and print a clear startup message before the first reading. Provide a runnable sketch.",
    requiredNets: [[pin("raspberry-pi-pico", "GP4"), pin("mpu-6050-breakout", "SDA"), pin("ssd1306-oled-128x64", "SDA")], [pin("raspberry-pi-pico", "GP5"), pin("mpu-6050-breakout", "SCL"), pin("ssd1306-oled-128x64", "SCL")], [pin("raspberry-pi-pico", "3V3"), pin("mpu-6050-breakout", "VCC"), pin("ssd1306-oled-128x64", "VCC")], [pin("raspberry-pi-pico", "GND", "GND2", "GND3"), pin("mpu-6050-breakout", "GND"), pin("ssd1306-oled-128x64", "GND")]],
    behavior: { description: "Render live tilt values and emit a startup/status message.", requiredSketchPatterns: ["MPU|6050|Wire", "acceler|tilt|atan2", "Serial|display"], evidence: "display" },
  },
  {
    id: "complex-sensor-05-gas-alarm", category: "sensor-control", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["arduino-uno"], expectedComponentTypes: ["arduino-uno", "mq-2-gas-sensor", "led", "resistor", "buzzer"],
    prompt: "Make an Arduino Uno gas-level alarm with an MQ-2 sensor, red LED plus series resistor, and buzzer. Power MQ-2 VCC/GND from 5V/GND and connect AOUT to A0. Drive the LED through its resistor from D8 and the buzzer from D9. Report the analog gas reading over Serial, activate both alarm outputs above an ADC count of 500, and release them below 450; include a complete sketch.",
    requiredNets: [[pin("arduino-uno", "A0"), pin("mq-2-gas-sensor", "AOUT")], [pin("arduino-uno", "5V"), pin("mq-2-gas-sensor", "VCC")], [pin("arduino-uno", "GND", "GND2", "GND3"), pin("mq-2-gas-sensor", "GND"), pin("led", "K"), pin("buzzer", "-")], [pin("arduino-uno", "D8"), pin("resistor", "1")], [pin("resistor", "2"), pin("led", "A")], [pin("arduino-uno", "D9"), pin("buzzer", "+")]],
    behavior: { description: "Report the sensor reading and switch alarm outputs using 500/450 hysteresis.", requiredSketchPatterns: ["analogRead", "500", "450", "Serial"], evidence: "serial" },
  },
  {
    id: "complex-sensor-06-soil-status", category: "sensor-control", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["esp32-nodemcu-32s"], expectedComponentTypes: ["esp32-nodemcu-32s", "soil-moisture-sen0193", "sh1107-oled-128x128", "led", "resistor"],
    prompt: "Build an ESP32 NodeMCU-32S plant-status monitor using a SEN0193 capacitive soil-moisture sensor, SH1107 OLED, and a green LED with a resistor. Read the sensor on input-only ADC GPIO34, power the sensor from 3V3, and put the OLED on GPIO21 SDA/GPIO22 SCL. Connect GPIO18 through the resistor to the LED anode and LED cathode to GND. Show calibrated moisture percent; turn the LED on below 30% and off above 38% to add hysteresis. Provide complete runnable code.",
    requiredNets: [[pin("esp32-nodemcu-32s", "GPIO34"), pin("soil-moisture-sen0193", "AOUT")], [pin("esp32-nodemcu-32s", "GPIO21"), pin("sh1107-oled-128x128", "SDA")], [pin("esp32-nodemcu-32s", "GPIO22"), pin("sh1107-oled-128x128", "SCL")], [pin("esp32-nodemcu-32s", "3V3"), pin("soil-moisture-sen0193", "VCC"), pin("sh1107-oled-128x128", "VCC")], [pin("esp32-nodemcu-32s", "GND", "GND2", "GND3"), pin("soil-moisture-sen0193", "GND"), pin("sh1107-oled-128x128", "GND"), pin("led", "K")], [pin("esp32-nodemcu-32s", "GPIO18"), pin("resistor", "1")], [pin("resistor", "2"), pin("led", "A")]],
    behavior: { description: "Show calibrated moisture and use separate 30%/38% switching thresholds.", requiredSketchPatterns: ["analogRead", "100", "30", "38", "display"], evidence: "display" },
  },
  {
    id: "complex-sensor-07-temperature-log", category: "sensor-control", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["arduino-nano-classic"], expectedComponentTypes: ["arduino-nano-classic", "ds18b20", "resistor", "led"],
    prompt: "Create an Arduino Nano Classic temperature logger with a DS18B20, a 4.7 kOhm data pull-up resistor, and an LED indicator. Connect DQ to D2 and one resistor lead, the other resistor lead to 5V, sensor VDD to 5V and sensor GND directly to the Nano GND pin. Connect the LED anode through its series resistor to D9 and LED cathode directly to that same Nano GND pin. Do not use separate ground symbols; explicitly wire every return to the same Nano GND net. Print temperature over Serial and turn on the LED above 32 C; supply complete code.",
    requiredNets: [[pin("arduino-nano-classic", "D2"), pin("ds18b20", "DQ"), pinAt("resistor", 0, "1")], [pin("arduino-nano-classic", "5V"), pin("ds18b20", "VDD"), pinAt("resistor", 0, "2")], [pin("arduino-nano-classic", "GND", "GND2"), pin("ds18b20", "GND"), pin("led", "K")], [pin("arduino-nano-classic", "D9"), pinAt("resistor", 1, "1")], [pinAt("resistor", 1, "2"), pin("led", "A")]],
    behavior: { description: "Log DS18B20 temperature and use the 32 C LED threshold.", requiredSketchPatterns: ["DS18B20|OneWire|DallasTemperature", "32", "digitalWrite", "Serial"], evidence: "serial" },
  },
  {
    id: "complex-sensor-08-co2-monitor", category: "sensor-control", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["xiao-esp32s3-sense"], expectedComponentTypes: ["xiao-esp32s3-sense", "scd41-co2-sensor", "apds-9960-proximity-gesture", "ssd1306-oled-128x64", "led", "resistor"],
    prompt: "Build a compact Seeed XIAO ESP32-S3 Sense indoor-air monitor with one SCD41 CO2 sensor, one APDS-9960 proximity/gesture sensor, one SSD1306 OLED, one amber LED, and three resistors. Use XIAO D4/GPIO5 as SDA and D5/GPIO6 as SCL for all three I2C devices. Add a separate 4.7k-ohm pull-up resistor labeled SDA pull-up from SDA to 3V3 and another labeled SCL pull-up from SCL to 3V3. Power the devices and pull-ups from 3V3; join every GND and LED cathode to XIAO GND. Connect LED anode through its third resistor labeled LED resistor to D2. Use Wire.begin(5,6), read SCD41 address 0x62 and APDS-9960 address 0x39, and render both readings on the OLED. Keep code concise and provide the complete sketch.",
    requiredNets: [[pin("xiao-esp32s3-sense", "D4", "GPIO5"), pin("scd41-co2-sensor", "SDA"), pin("ssd1306-oled-128x64", "SDA"), pin("apds-9960-proximity-gesture", "SDA"), pinLabeled("resistor", "SDA pull-up", "1")], [pinLabeled("resistor", "SDA pull-up", "2"), pin("xiao-esp32s3-sense", "3V3")], [pin("xiao-esp32s3-sense", "D5", "GPIO6"), pin("scd41-co2-sensor", "SCL"), pin("ssd1306-oled-128x64", "SCL"), pin("apds-9960-proximity-gesture", "SCL"), pinLabeled("resistor", "SCL pull-up", "1")], [pinLabeled("resistor", "SCL pull-up", "2"), pin("xiao-esp32s3-sense", "3V3")], [pin("xiao-esp32s3-sense", "3V3"), pin("scd41-co2-sensor", "VDD"), pin("ssd1306-oled-128x64", "VCC"), pin("apds-9960-proximity-gesture", "VIN")], [pin("xiao-esp32s3-sense", "GND"), pin("scd41-co2-sensor", "GND"), pin("ssd1306-oled-128x64", "GND"), pin("apds-9960-proximity-gesture", "GND"), pin("led", "K")], [pin("xiao-esp32s3-sense", "D2"), pinLabeled("resistor", "LED resistor", "1")], [pinLabeled("resistor", "LED resistor", "2"), pin("led", "A")]],
    behavior: { description: "Show CO2 ppm and apply the 1000 ppm warning level.", requiredSketchPatterns: ["SCD41|CO2|Wire", "1000", "display|digitalWrite"], evidence: "display" },
  },

  // 6 robotics/motion builds
  {
    id: "complex-robot-01-three-axis-arm", category: "robotics-motion", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["arduino-uno"], expectedComponentTypes: ["arduino-uno", "sg90-servo", "potentiometer", "dc-supply"],
    prompt: "Build a three-axis tabletop robot arm controller on an Arduino Uno with exactly three SG90 servos named base, shoulder, and elbow, plus one potentiometer for each axis. Map the three SIG pins to D9/D10/D11 and the three pot SIG pins to A0/A1/A2; power every pot from 5V/GND and all servos from a separate regulated 5V supply with a common Uno ground. Keep each axis independent and map each knob to a safe 10–170 degree angle. Provide complete code.",
    requiredNets: [[pin("arduino-uno", "D9"), pinAt("sg90-servo", 0, "SIG")], [pin("arduino-uno", "D10"), pinAt("sg90-servo", 1, "SIG")], [pin("arduino-uno", "D11"), pinAt("sg90-servo", 2, "SIG")], [pin("arduino-uno", "A0"), pinAt("potentiometer", 0, "SIG")], [pin("arduino-uno", "A1"), pinAt("potentiometer", 1, "SIG")], [pin("arduino-uno", "A2"), pinAt("potentiometer", 2, "SIG")], [pin("dc-supply", "+"), pinAt("sg90-servo", 0, "VCC"), pinAt("sg90-servo", 1, "VCC"), pinAt("sg90-servo", 2, "VCC")], [pin("dc-supply", "-"), pin("arduino-uno", "GND", "GND2", "GND3"), pinAt("sg90-servo", 0, "GND"), pinAt("sg90-servo", 1, "GND"), pinAt("sg90-servo", 2, "GND")], [pin("arduino-uno", "5V"), pinAt("potentiometer", 0, "VCC"), pinAt("potentiometer", 1, "VCC"), pinAt("potentiometer", 2, "VCC")], [pin("arduino-uno", "GND", "GND2", "GND3"), pinAt("potentiometer", 0, "GND"), pinAt("potentiometer", 1, "GND"), pinAt("potentiometer", 2, "GND")]],
    behavior: { description: "Attach three independent servos and map three analog controls to bounded joint angles.", requiredSketchPatterns: ["analogRead", "Servo", "write", "constrain|map"], evidence: "servo" },
  },
  {
    id: "complex-robot-02-ultrasonic-rover", category: "robotics-motion", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["esp32-nodemcu-32s"], expectedComponentTypes: ["esp32-nodemcu-32s", "tb6612fng", "dc-motor", "hc-sr04", "dc-supply"],
    prompt: "Build a compact ESP32 NodeMCU-32S two-wheel obstacle-stop rover with exactly one TB6612FNG, two DC motors, one HC-SR04, and one 6 V DC motor supply. Wire driver PWMA/AIN1/AIN2 to GPIO25/26/27, PWMB/BIN1/BIN2 to GPIO14/12/13, STBY to GPIO23, and TRIG/ECHO to GPIO4/5. Connect one motor to AO1/AO2 and the other to BO1/BO2. Power TB6612 VM from 6 V, VCC from 3V3, HC-SR04 from 5V, and join supply negative, ESP32 GND, driver GND, and sensor GND. In a concise complete sketch, measure distance; drive both motors forward only above 25 cm and stop them at or below 25 cm. Include no extra boards, sensors, actuators, or unrelated code.",
    requiredNets: [[pin("esp32-nodemcu-32s", "GPIO25"), pin("tb6612fng", "PWMA")], [pin("esp32-nodemcu-32s", "GPIO26"), pin("tb6612fng", "AIN1")], [pin("esp32-nodemcu-32s", "GPIO27"), pin("tb6612fng", "AIN2")], [pin("esp32-nodemcu-32s", "GPIO14"), pin("tb6612fng", "PWMB")], [pin("esp32-nodemcu-32s", "GPIO4"), pin("hc-sr04", "TRIG")], [pin("esp32-nodemcu-32s", "GPIO5"), pin("hc-sr04", "ECHO")], [pin("tb6612fng", "AO1_1"), pinAt("dc-motor", 0, "+")], [pin("tb6612fng", "AO2_5"), pinAt("dc-motor", 0, "-")], [pin("tb6612fng", "BO1_11"), pinAt("dc-motor", 1, "+")], [pin("tb6612fng", "BO2_7"), pinAt("dc-motor", 1, "-")], [pin("dc-supply", "+"), pin("tb6612fng", "VM1", "VM2", "VM3")], [pin("dc-supply", "-"), pin("esp32-nodemcu-32s", "GND", "GND2", "GND3"), pin("tb6612fng", "GND", "PGND1_3", "PGND2_9"), pin("hc-sr04", "GND")], [pin("esp32-nodemcu-32s", "3V3"), pin("tb6612fng", "VCC")], [pin("esp32-nodemcu-32s", "GPIO23"), pin("tb6612fng", "STBY")], [pin("esp32-nodemcu-32s", "5V"), pin("hc-sr04", "VCC")]],
    behavior: { description: "Drive both motors forward when clear and stop at the 25 cm obstacle limit.", requiredSketchPatterns: ["pulseIn|distance", "25", "analogWrite|digitalWrite", "AIN1|PWMA"], evidence: "motor" },
  },
  {
    id: "complex-robot-03-stepper-indexer", category: "robotics-motion", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["arduino-mega-2560"], expectedComponentTypes: ["arduino-mega-2560", "a4988-stepper-driver", "nema17-stepper-17hs4401s", "dc-supply"],
    prompt: "Create a repeatable indexing axis on an Arduino Mega 2560 using an A4988 driver and a 17HS4401S NEMA 17 motor. Use named sketch constants `const int stepPin=2, dirPin=3, enPin=4;` and connect STEP/DIR/EN to Mega D2/D3/D4, VDD to 5V, VMOT to a separate 12 V supply, both driver ground pins and supply negative to Mega GND, and the motor's two coil pairs to 1A/1B and 2A/2B. Tie RESET to SLP, then wire that joined RST/SLP net directly to VDD/5V so it is HIGH; do not put either pin on a GPIO. Tie MS1/MS2/MS3 LOW to Mega GND for full steps. Pulse STEP for 200 forward steps, pause, then return with reversed DIR; provide a complete runnable sketch.",
    requiredNets: [[pin("arduino-mega-2560", "D2"), pin("a4988-stepper-driver", "STEP")], [pin("arduino-mega-2560", "D3"), pin("a4988-stepper-driver", "DIR")], [pin("arduino-mega-2560", "D4"), pin("a4988-stepper-driver", "EN")], [pin("arduino-mega-2560", "5V"), pin("a4988-stepper-driver", "VDD", "RST", "SLP")], [pin("dc-supply", "+"), pin("a4988-stepper-driver", "VMOT")], [pin("dc-supply", "-"), pin("arduino-mega-2560", "GND", "GND2", "GND3", "GND4"), pin("a4988-stepper-driver", "GND_14", "GND_15")], [pin("arduino-mega-2560", "GND", "GND2", "GND3", "GND4"), pin("a4988-stepper-driver", "MS1", "MS2", "MS3")], [pin("a4988-stepper-driver", "1A"), pin("nema17-stepper-17hs4401s", "A1")], [pin("a4988-stepper-driver", "1B"), pin("nema17-stepper-17hs4401s", "A2")], [pin("a4988-stepper-driver", "2A"), pin("nema17-stepper-17hs4401s", "B1")], [pin("a4988-stepper-driver", "2B"), pin("nema17-stepper-17hs4401s", "B2")]],
    behavior: { description: "Pulse the stepper forward by 200 full steps, then reverse it.", requiredSketchPatterns: ["digitalWrite", "200", "delayMicroseconds|delay"], evidence: "stepper-indexer" },
  },
  {
    id: "complex-robot-04-joystick-stepper", category: "robotics-motion", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["raspberry-pi-pico"], expectedComponentTypes: ["raspberry-pi-pico", "ky-023-joystick", "stepper-28byj-48", "uln2003-stepper-driver"],
    prompt: "Build a Raspberry Pi Pico joystick-controlled indexer with a KY-023 joystick, ULN2003 driver, and 5 V 28BYJ-48 unipolar stepper motor. Connect the joystick X/Y outputs to GP26/GP27 and SW to GP14, its supply to 3V3/GND; connect ULN2003 IN1–IN4 to GP2–GP5, GND to Pico GND, COM and the motor common wire to VBUS 5V, and motor A–D to OUT1–OUT4. Center the stick to hold position and step left/right at a bounded speed. Remember Pico analogRead() defaults to 0–1023 (center near 512); do not use ESP32-style 3000 thresholds unless you explicitly set 12-bit resolution. Generate runnable code.",
    requiredNets: [[pin("raspberry-pi-pico", "GP26"), pin("ky-023-joystick", "VRX")], [pin("raspberry-pi-pico", "GP27"), pin("ky-023-joystick", "VRY")], [pin("raspberry-pi-pico", "GP14"), pin("ky-023-joystick", "SW")], [pin("raspberry-pi-pico", "GP2"), pin("uln2003-stepper-driver", "IN1")], [pin("raspberry-pi-pico", "GP3"), pin("uln2003-stepper-driver", "IN2")], [pin("raspberry-pi-pico", "GP4"), pin("uln2003-stepper-driver", "IN3")], [pin("raspberry-pi-pico", "GP5"), pin("uln2003-stepper-driver", "IN4")], [pin("raspberry-pi-pico", "3V3"), pin("ky-023-joystick", "VCC")], [pin("raspberry-pi-pico", "GND", "GND2", "GND3"), pin("ky-023-joystick", "GND"), pin("uln2003-stepper-driver", "GND")], [pin("raspberry-pi-pico", "VBUS"), pin("uln2003-stepper-driver", "COM"), pin("stepper-28byj-48", "COM")], [pin("uln2003-stepper-driver", "OUT1"), pin("stepper-28byj-48", "A")], [pin("uln2003-stepper-driver", "OUT2"), pin("stepper-28byj-48", "B")], [pin("uln2003-stepper-driver", "OUT3"), pin("stepper-28byj-48", "C")], [pin("uln2003-stepper-driver", "OUT4"), pin("stepper-28byj-48", "D")]],
    behavior: { description: "Read joystick direction and sequence four stepper coils to move left/right.", requiredSketchPatterns: ["analogRead", "step|sequence", "digitalWrite"], evidence: "joystick-stepper" },
  },
  {
    id: "complex-robot-05-encoder-servo", category: "robotics-motion", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["esp32-devkitc-v4"], expectedComponentTypes: ["esp32-devkitc-v4", "as5600-magnetic-encoder", "mg996r-servo", "dc-supply"],
    prompt: "Build an ESP32 DevKitC V4 magnetic position follower with an AS5600 I2C encoder and an MG996R servo. Use GPIO21/22 for SDA/SCL, power the encoder from 3V3, connect its OUT to GPIO34 as a second diagnostic input, and attach servo SIG to GPIO18. Power the servo from a regulated external 5 V supply and join its negative to ESP32 GND. Convert the encoder angle to a safe 10–170 degree servo target and print both angles over Serial; provide complete code.",
    requiredNets: [[pin("esp32-devkitc-v4", "GPIO21"), pin("as5600-magnetic-encoder", "SDA")], [pin("esp32-devkitc-v4", "GPIO22"), pin("as5600-magnetic-encoder", "SCL")], [pin("esp32-devkitc-v4", "3V3"), pin("as5600-magnetic-encoder", "VCC")], [pin("esp32-devkitc-v4", "GND", "GND2", "GND3"), pin("as5600-magnetic-encoder", "GND")], [pin("esp32-devkitc-v4", "GPIO34"), pin("as5600-magnetic-encoder", "OUT")], [pin("esp32-devkitc-v4", "GPIO18"), pin("mg996r-servo", "SIG")], [pin("dc-supply", "+"), pin("mg996r-servo", "VCC")], [pin("dc-supply", "-"), pin("esp32-devkitc-v4", "GND", "GND2", "GND3"), pin("mg996r-servo", "GND")]],
    behavior: { description: "Read the encoder, command a bounded servo angle, and print both values.", requiredSketchPatterns: ["AS5600|Wire", "Servo", "10", "170", "Serial"], evidence: "servo" },
  },
  {
    id: "complex-robot-06-joystick-gimbal", category: "robotics-motion", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["xiao-esp32s3-sense"], expectedComponentTypes: ["xiao-esp32s3-sense", "ky-023-joystick", "sg90-servo", "dc-supply"],
    prompt: "Create a compact two-axis gimbal on a XIAO ESP32-S3 Sense with one KY-023 joystick, exactly two SG90 servos, and one regulated 5 V DC supply; add no other parts or generic servo. Connect joystick VRX/VRY/SW to D0/D1/D2 and VCC/GND to 3V3/XIAO GND. Connect servo SIG to D8/D9. Wire supply + directly to both servo VCC pins only. Wire supply - directly to XIAO GND and both servo GND pins; keep + and - on separate nets and never connect + to ground. Do not add ground symbols. Map joystick axes to bounded 15–165 degree angles and center both servos when released. Return concise complete code.",
    requiredNets: [[pin("xiao-esp32s3-sense", "D0"), pin("ky-023-joystick", "VRX")], [pin("xiao-esp32s3-sense", "D1"), pin("ky-023-joystick", "VRY")], [pin("xiao-esp32s3-sense", "D2"), pin("ky-023-joystick", "SW")], [pin("xiao-esp32s3-sense", "3V3"), pin("ky-023-joystick", "VCC")], [pin("xiao-esp32s3-sense", "GND"), pin("ky-023-joystick", "GND")], [pin("xiao-esp32s3-sense", "D8"), pinAt("sg90-servo", 0, "SIG")], [pin("xiao-esp32s3-sense", "D9"), pinAt("sg90-servo", 1, "SIG")], [pin("dc-supply", "+"), pinAt("sg90-servo", 0, "VCC"), pinAt("sg90-servo", 1, "VCC")], [pin("dc-supply", "-"), pin("xiao-esp32s3-sense", "GND"), pinAt("sg90-servo", 0, "GND"), pinAt("sg90-servo", 1, "GND")]],
    behavior: { description: "Move two independent servo axes from joystick input within safe bounds.", requiredSketchPatterns: ["analogRead", "Servo", "15", "165", "write"], evidence: "servo" },
  },

  // 5 multi-board builds; each has explicit cross-board signal and ground nets.
  {
    id: "complex-multi-01-climate-uart", category: "multi-board", group: "multi-board", minimumBoards: 2,
    expectedBoardTypes: ["esp32-devkit-v1-30pin", "xiao-esp32s3-sense"], expectedComponentTypes: ["esp32-devkit-v1-30pin", "xiao-esp32s3-sense", "dht22", "sh1107-oled-128x128"],
    prompt: "Build a two-board climate dashboard: the 30-pin ESP32 DevKit V1 reads a DHT22, then sends temperature/humidity text over UART0 to a XIAO ESP32-S3 Sense, which displays the received values on an SH1107 OLED. On the sender use GPIO1 TX/GPIO3 RX and DHT DATA on GPIO4; on the XIAO use D6/GPIO43 TX and D7/GPIO44 RX. Cross sender TX to receiver RX and receiver TX to sender RX, connect common ground, and wire the OLED on XIAO D4/D5 I2C. Supply a complete compiled sketch for each board.",
    requiredNets: [[pin("esp32-devkit-v1-30pin", "GPIO1"), pin("xiao-esp32s3-sense", "D7", "GPIO44")], [pin("xiao-esp32s3-sense", "D6", "GPIO43"), pin("esp32-devkit-v1-30pin", "GPIO3")], [pin("esp32-devkit-v1-30pin", "GND", "GND2"), pin("xiao-esp32s3-sense", "GND")], [pin("esp32-devkit-v1-30pin", "GPIO4"), pin("dht22", "DATA")], [pin("xiao-esp32s3-sense", "D4", "GPIO5"), pin("sh1107-oled-128x128", "SDA")], [pin("xiao-esp32s3-sense", "D5", "GPIO6"), pin("sh1107-oled-128x128", "SCL")]],
    behavior: { description: "Transmit sensor readings over a crossed UART and render them on the second board's display.", requiredSketchPatterns: ["Serial", "DHT", "display|print"], evidence: "display" },
  },
  {
    id: "complex-multi-02-motion-event", category: "multi-board", group: "multi-board", minimumBoards: 2,
    expectedBoardTypes: ["arduino-uno", "arduino-mega-2560"], expectedComponentTypes: ["arduino-uno", "arduino-mega-2560", "hc-sr501", "led", "resistor"],
    prompt: "Build a two-board motion annunciator. An Arduino Uno reads one HC-SR501 PIR module on D2 and sends a one-character motion event over its hardware Serial port to an Arduino Mega 2560. The Mega receives on Serial1 RX D19/TX D18 and turns a red LED on while motion is reported. Wire Uno TX D1 to Mega D19, Mega D18 back to Uno RX D0, and directly wire one Uno GND pin to one Mega GND pin; do not rely on separate ground symbols. Power the PIR from Uno 5V and wire its GND directly to that Uno GND. Connect Mega D13 through a resistor to LED anode and LED cathode directly to Mega GND. Include separate complete sketches for both boards.",
    requiredNets: [[pin("arduino-uno", "D1"), pin("arduino-mega-2560", "D19")], [pin("arduino-mega-2560", "D18"), pin("arduino-uno", "D0")], [pin("arduino-uno", "GND", "GND2", "GND3"), pin("arduino-mega-2560", "GND", "GND2", "GND3", "GND4")], [pin("arduino-uno", "D2"), pin("hc-sr501", "OUT")], [pin("arduino-uno", "5V"), pin("hc-sr501", "VCC")], [pin("arduino-uno", "GND", "GND2", "GND3"), pin("hc-sr501", "GND")], [pin("arduino-mega-2560", "D13"), pin("resistor", "1")], [pin("resistor", "2"), pin("led", "A")]],
    behavior: { description: "Pass a motion event from Uno to Mega and visibly switch the receiver LED.", requiredSketchPatterns: ["Serial", "Serial1", "digitalRead|OUT", "digitalWrite"], evidence: "digital-output" },
  },
  {
    id: "complex-multi-03-analog-console", category: "multi-board", group: "multi-board", minimumBoards: 2,
    expectedBoardTypes: ["raspberry-pi-pico", "esp32-nodemcu-32s"], expectedComponentTypes: ["raspberry-pi-pico", "esp32-nodemcu-32s", "potentiometer", "tm1637-4-digit-display"],
    prompt: "Create a two-board analog readout: a Raspberry Pi Pico samples a potentiometer on GP26 and sends its raw ADC count over UART0; an ESP32 NodeMCU-32S receives it and shows the number on a TM1637 four-digit display. Power the potentiometer from Pico 3V3/GND, connect Pico GP0 TX to ESP32 GPIO3 RX and ESP32 GPIO1 TX to Pico GP1 RX, and share ground. Connect display CLK/DIO to ESP32 GPIO18/GPIO19 and power it from 3V3/GND. Deliver one complete sketch per board and demonstrate the value update.",
    requiredNets: [[pin("raspberry-pi-pico", "GP26"), pin("potentiometer", "SIG")], [pin("raspberry-pi-pico", "GP0"), pin("esp32-nodemcu-32s", "GPIO3")], [pin("esp32-nodemcu-32s", "GPIO1"), pin("raspberry-pi-pico", "GP1")], [pin("raspberry-pi-pico", "GND", "GND2", "GND3"), pin("esp32-nodemcu-32s", "GND", "GND2", "GND3")], [pin("esp32-nodemcu-32s", "GPIO18"), pin("tm1637-4-digit-display", "CLK")], [pin("esp32-nodemcu-32s", "GPIO19"), pin("tm1637-4-digit-display", "DIO")]],
    behavior: { description: "Stream the live analog sample to the second board and show it on the numeric display.", requiredSketchPatterns: ["analogRead", "Serial", "display|CLK|DIO"], evidence: "display" },
  },
  {
    id: "complex-multi-04-air-quality", category: "multi-board", group: "multi-board", minimumBoards: 2,
    expectedBoardTypes: ["freenove-esp32s3-wroom", "esp8266-nodemcu-v1"], expectedComponentTypes: ["freenove-esp32s3-wroom", "esp8266-nodemcu-v1", "scd41-co2-sensor", "ssd1306-oled-128x64"],
    prompt: "Build an air-quality pair with a Freenove ESP32-S3-WROOM and exactly one SCD41 sensor on its default GPIO8 SDA/GPIO9 SCL I2C bus, sending CO2 ppm to an ESP8266 NodeMCU that shows the received number on an SSD1306 OLED. The Freenove physical header does not expose GPIO43/44, so do not use them. Use supported SoftwareSerial pins: on Freenove RX=GPIO18 and TX=GPIO17; on NodeMCU RX=D6/GPIO12 and TX=D5/GPIO14. Cross Freenove GPIO17 TX to NodeMCU D6 RX and NodeMCU D5 TX to Freenove GPIO18 RX. Directly wire both boards' GND pins together. Wire OLED SDA/SCL to NodeMCU D2/D1, power the OLED from 3V3, and connect its GND to NodeMCU GND. Write two complete sketches using SoftwareSerial and render the received CO2 reading.",
    requiredNets: [[pin("freenove-esp32s3-wroom", "GPIO17"), pin("esp8266-nodemcu-v1", "D6", "GPIO12")], [pin("esp8266-nodemcu-v1", "D5", "GPIO14"), pin("freenove-esp32s3-wroom", "GPIO18")], [pin("freenove-esp32s3-wroom", "GND", "GND2", "GND3"), pin("esp8266-nodemcu-v1", "GND", "GND2", "GND3")], [pin("freenove-esp32s3-wroom", "GPIO8"), pin("scd41-co2-sensor", "SDA")], [pin("freenove-esp32s3-wroom", "GPIO9"), pin("scd41-co2-sensor", "SCL")], [pin("esp8266-nodemcu-v1", "D2"), pin("ssd1306-oled-128x64", "SDA")], [pin("esp8266-nodemcu-v1", "D1"), pin("ssd1306-oled-128x64", "SCL")]],
    behavior: { description: "Send a CO2 sample over the board-to-board UART link and render it at the receiver.", requiredSketchPatterns: ["Serial", "SCD41|CO2", "display|print"], evidence: "display" },
  },
  {
    id: "complex-multi-05-temperature-display", category: "multi-board", group: "multi-board", minimumBoards: 2,
    expectedBoardTypes: ["arduino-nano-classic", "esp32-devkitc-v4"], expectedComponentTypes: ["arduino-nano-classic", "esp32-devkitc-v4", "dht11", "tm1637-4-digit-display"],
    prompt: "Use an Arduino Nano Classic as a DHT11 temperature/humidity sender and an ESP32 DevKitC V4 as a TM1637 display receiver. Wire Nano DHT DATA to D2 and sensor VCC/GND to 5V/GND. Cross UART0: Nano D1 TX to ESP32 GPIO3 RX and ESP32 GPIO1 TX to Nano D0 RX, with common ground. Connect the TM1637 CLK/DIO to ESP32 GPIO18/GPIO19 and power/ground to ESP32 3V3/GND. Send a compact numeric reading and display it; provide a separate complete sketch for each board.",
    requiredNets: [[pin("arduino-nano-classic", "D2"), pin("dht11", "DATA")], [pin("arduino-nano-classic", "D1"), pin("esp32-devkitc-v4", "GPIO3")], [pin("esp32-devkitc-v4", "GPIO1"), pin("arduino-nano-classic", "D0")], [pin("arduino-nano-classic", "GND", "GND2"), pin("esp32-devkitc-v4", "GND", "GND2", "GND3")], [pin("esp32-devkitc-v4", "GPIO18"), pin("tm1637-4-digit-display", "CLK")], [pin("esp32-devkitc-v4", "GPIO19"), pin("tm1637-4-digit-display", "DIO")]],
    behavior: { description: "Transmit measured temperature and show the received value on the ESP32 display.", requiredSketchPatterns: ["DHT", "Serial", "display|CLK|DIO"], evidence: "display" },
  },

  // 5 edits run after the source builds above.
  {
    id: "complex-edit-01-climate-mute", category: "circuit-preserving-edit", group: "edit", baseCaseId: "complex-sensor-01-climate-oled", minimumBoards: 1,
    expectedBoardTypes: ["arduino-uno"], expectedComponentTypes: ["arduino-uno", "dht11", "ssd1306-oled-128x64", "buzzer", "push-button"],
    prompt: "Edit the current climate monitor and preserve every existing component ID, wire ID, DHT11 reading, OLED display, and 28 C alarm behavior. Add a push button from unused Uno D4 to GND using INPUT_PULLUP; each press should toggle a persistent buzzer mute while readings and the OLED continue updating. Keep the original wiring intact and provide the revised complete sketch.",
    requiredNets: [[pin("arduino-uno", "D4"), pin("push-button", "1")], [pin("arduino-uno", "GND", "GND2", "GND3"), pin("push-button", "2")]],
    behavior: { description: "Keep the original monitor and add a persistent, press-edge mute control.", requiredSketchPatterns: ["digitalRead", "INPUT_PULLUP", "mute|silence", "DHT"], evidence: "display" },
  },
  {
    id: "complex-edit-02-arm-enable", category: "circuit-preserving-edit", group: "edit", baseCaseId: "complex-robot-01-three-axis-arm", minimumBoards: 1,
    expectedBoardTypes: ["arduino-uno"], expectedComponentTypes: ["arduino-uno", "sg90-servo", "potentiometer", "dc-supply", "push-button"],
    prompt: "Edit the existing three-axis base/shoulder/elbow arm controller. Preserve all three SG90s, their individual potentiometers, all existing component and wire IDs, pin assignments, and angle limits. Add a normally-open master-enable button from D4 to GND with INPUT_PULLUP. Treat it as a momentary hold-to-enable control: while the button is pressed, restore independent knob control; as soon as it is released, command all three joints safely to center at 90 degrees. Do not latch or toggle. Keep the three servos and controls, do not rebuild the circuit, and return the complete updated sketch.",
    requiredNets: [[pin("arduino-uno", "D4"), pin("push-button", "1")], [pin("arduino-uno", "GND", "GND2", "GND3"), pin("push-button", "2")]],
    behavior: { description: "Preserve the independent axes and add a momentary enable button that centers all joints when released.", requiredSketchPatterns: ["digitalRead", "INPUT_PULLUP", "Servo", "analogRead", "write\\(90\\)"], evidence: "servo" },
  },
  {
    id: "complex-edit-03-uart-alert", category: "circuit-preserving-edit", group: "edit", baseCaseId: "complex-multi-01-climate-uart", minimumBoards: 2,
    expectedBoardTypes: ["esp32-devkit-v1-30pin", "xiao-esp32s3-sense"], expectedComponentTypes: ["esp32-devkit-v1-30pin", "xiao-esp32s3-sense", "dht22", "sh1107-oled-128x128", "buzzer"],
    prompt: "Edit the existing two-board climate dashboard and preserve both boards, the DHT22, all UART crossover wires, the XIAO OLED, and every existing ID. Add a buzzer to the XIAO on D2 and common GND; use the received temperature to sound it above 30 C while continuing to display temperature and humidity. Keep separate compilable sketches for both controllers and do not change the UART pins.",
    requiredNets: [[pin("xiao-esp32s3-sense", "D2"), pin("buzzer", "+")], [pin("xiao-esp32s3-sense", "GND"), pin("buzzer", "-")]],
    behavior: { description: "Preserve the cross-board data/display path and add the receiver-side 30 C audible alert.", requiredSketchPatterns: ["Serial", "30", "tone|digitalWrite", "display|print"], evidence: "display" },
  },
  {
    id: "complex-edit-04-temperature-button", category: "circuit-preserving-edit", group: "edit", baseCaseId: "complex-sensor-07-temperature-log", minimumBoards: 1,
    expectedBoardTypes: ["arduino-nano-classic"], expectedComponentTypes: ["arduino-nano-classic", "ds18b20", "resistor", "led", "push-button"],
    prompt: "Edit the existing Nano DS18B20 logger. Preserve the sensor, its D2 one-wire bus and pull-up, LED, all original component IDs and wires, Serial logging, and the 32 C alarm. Add a push button from D3 to GND with INPUT_PULLUP that toggles Celsius/Fahrenheit display units without changing the alarm threshold. Keep the LED behavior and produce the complete revised sketch.",
    requiredNets: [[pin("arduino-nano-classic", "D3"), pin("push-button", "1")], [pin("arduino-nano-classic", "GND", "GND2"), pin("push-button", "2")]],
    behavior: { description: "Keep temperature logging and alarm behavior while toggling displayed units on button presses.", requiredSketchPatterns: ["DS18B20|OneWire", "digitalRead", "INPUT_PULLUP", "Fahrenheit|\\*\\s*9(?:\\.0+)?\\s*/\\s*5(?:\\.0+)?"], evidence: "serial" },
  },
  {
    id: "complex-edit-05-stream-hold", category: "circuit-preserving-edit", group: "edit", baseCaseId: "complex-multi-03-analog-console", minimumBoards: 2,
    expectedBoardTypes: ["raspberry-pi-pico", "esp32-nodemcu-32s"], expectedComponentTypes: ["raspberry-pi-pico", "esp32-nodemcu-32s", "potentiometer", "tm1637-4-digit-display", "push-button"],
    prompt: "Edit the current Pico-to-ESP32 analog console. Preserve both boards, the UART crossover and common ground, the potentiometer, display wiring, and all existing IDs. Add a push button from Pico GP14 to GND. Each press should toggle a hold mode: the ESP32 keeps the last received value on the TM1637 while held in hold mode, then resumes live updates after the next press. Keep a complete sketch for each board.",
    requiredNets: [[pin("raspberry-pi-pico", "GP14"), pin("push-button", "1")], [pin("raspberry-pi-pico", "GND", "GND2", "GND3"), pin("push-button", "2")]],
    behavior: { description: "Preserve live UART display updates and add a press-toggle hold/resume behavior.", requiredSketchPatterns: ["Serial", "digitalRead", "hold|freeze|pause", "display|CLK|DIO"], evidence: "display" },
  },

  // 6 power/bus/display integrations
  {
    id: "complex-power-01-shared-i2c", category: "power-bus-display", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["arduino-mega-2560"], expectedComponentTypes: ["arduino-mega-2560", "bme680-gas-sensor", "sgp40-voc-sensor", "sh1107-oled-128x128"],
    prompt: "Build an Arduino Mega 2560 indoor-air dashboard with a BME680, SGP40 VOC sensor, and SH1107 OLED sharing one I2C bus. Connect all SDA pins to Mega SDA/D20 and all SCL pins to Mega SCL/D21; power each breakout from 3V3 and join all grounds to Mega GND. Read temperature/humidity and VOC index, show all three on the OLED, and print a concise status line to Serial. Generate complete code and keep the two sensor addresses distinct.",
    requiredNets: [[pin("arduino-mega-2560", "SDA", "D20"), pin("bme680-gas-sensor", "SDA"), pin("sgp40-voc-sensor", "SDA"), pin("sh1107-oled-128x128", "SDA")], [pin("arduino-mega-2560", "SCL", "D21"), pin("bme680-gas-sensor", "SCL"), pin("sgp40-voc-sensor", "SCL"), pin("sh1107-oled-128x128", "SCL")], [pin("arduino-mega-2560", "3V3"), pin("bme680-gas-sensor", "VIN"), pin("sgp40-voc-sensor", "VIN"), pin("sh1107-oled-128x128", "VCC")], [pin("arduino-mega-2560", "GND", "GND2", "GND3", "GND4"), pin("bme680-gas-sensor", "GND"), pin("sgp40-voc-sensor", "GND"), pin("sh1107-oled-128x128", "GND")]],
    behavior: { description: "Read both I2C sensors on the shared bus and display a combined air-quality status.", requiredSketchPatterns: ["Wire", "BME680|temperature", "SGP40|VOC", "display|print"], evidence: "display" },
  },
  {
    id: "complex-power-02-shared-spi-displays", category: "power-bus-display", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["arduino-uno"], expectedComponentTypes: ["arduino-uno", "st7735s-tft-1-8", "max7219-8x8-matrix"],
    prompt: "Create an Arduino Uno dual-display demo with one 1.8-inch ST7735S SPI TFT and one MAX7219 8x8 matrix. Share the SPI clock/data signals using Uno D13 SCK and D11 MOSI; give TFT CS D10 and matrix CS D9 so they never select at once. Connect the TFT's SCL/SDA to SCK/MOSI, RES/DC/BL to D8/D7/D6, and its 3V3/GND correctly; power the MAX7219 from 5V/GND. Initialize the MAX7219 shutdown, decode, scan-limit, and intensity registers, then write nonzero row data to display a changing counter. Show a short status on the TFT. Provide complete code.",
    requiredNets: [[pin("arduino-uno", "D13", "SCK"), pin("st7735s-tft-1-8", "SCL"), pin("max7219-8x8-matrix", "CLK")], [pin("arduino-uno", "D11", "MOSI"), pin("st7735s-tft-1-8", "SDA"), pin("max7219-8x8-matrix", "DIN")], [pin("arduino-uno", "D10", "SS"), pin("st7735s-tft-1-8", "CS")], [pin("arduino-uno", "D9"), pin("max7219-8x8-matrix", "CS")], [pin("arduino-uno", "3V3"), pin("st7735s-tft-1-8", "VCC")], [pin("arduino-uno", "5V"), pin("max7219-8x8-matrix", "VCC")]],
    behavior: { description: "Initialize the MAX7219 and show nonzero row pixels while keeping each display's chip-select independent.", requiredSketchPatterns: ["SPI\\.transfer", "digitalWrite", "D10|10", "D9|9"], evidence: "matrix-and-spi-display" },
  },
  {
    id: "complex-power-03-battery-vin", category: "power-bus-display", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["arduino-uno"], expectedComponentTypes: ["arduino-uno", "battery-9v", "led", "resistor", "capacitor-1uf"],
    prompt: "Build a minimal Arduino Uno indicator circuit with exactly one 9 V battery, one 1 uF capacitor, one red LED, and one 220-ohm resistor. Wire battery + to VIN and battery - to Uno GND. Connect the capacitor between 5V and GND. Wire D13 through the resistor to LED anode; connect LED cathode to GND. Blink D13 once per second. Return only a compact complete project and short complete sketch (under 25 lines); do not add parts, duplicate wires, or lengthy explanations.",
    requiredNets: [[pin("battery-9v", "+"), pin("arduino-uno", "VIN")], [pin("battery-9v", "-"), pin("arduino-uno", "GND", "GND2", "GND3")], [pin("arduino-uno", "5V"), pin("capacitor-1uf", "1")], [pin("arduino-uno", "GND", "GND2", "GND3"), pin("capacitor-1uf", "2")], [pin("arduino-uno", "D13"), pin("resistor", "1")], [pin("resistor", "2"), pin("led", "A")]],
    behavior: { description: "Blink the power-on LED while using the documented battery polarity and decoupling capacitor.", requiredSketchPatterns: ["pinMode", "digitalWrite", "delay", "13"], evidence: "digital-output" },
  },
  {
    id: "complex-power-04-bme-display", category: "power-bus-display", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["esp32-devkitc-v4"], expectedComponentTypes: ["esp32-devkitc-v4", "bme280-gy-bme-p280", "tm1637-4-digit-display"],
    prompt: "Build an ESP32 DevKitC V4 temperature display using exactly one catalog part named GY-BME/P280 BME280 Breakout (not the bare-chip BME280) on GPIO21/22 I2C and one TM1637 four-digit module on GPIO18/GPIO19. Power both modules from 3V3 and join their grounds to ESP32 GND. Show temperature in tenths of a degree on TM1637; print temperature, humidity, and pressure over Serial. Keep the project and sketch concise; provide complete code.",
    requiredNets: [[pin("esp32-devkitc-v4", "GPIO21"), pin("bme280-gy-bme-p280", "SDA")], [pin("esp32-devkitc-v4", "GPIO22"), pin("bme280-gy-bme-p280", "SCL")], [pin("esp32-devkitc-v4", "GPIO18"), pin("tm1637-4-digit-display", "CLK")], [pin("esp32-devkitc-v4", "GPIO19"), pin("tm1637-4-digit-display", "DIO")], [pin("esp32-devkitc-v4", "3V3"), pin("bme280-gy-bme-p280", "VCC"), pin("tm1637-4-digit-display", "VCC")]],
    behavior: { description: "Display temperature while reporting all BME280 readings over Serial.", requiredSketchPatterns: ["BME280|Wire", "temperature", "Serial", "display|CLK|DIO"], evidence: "display" },
  },
  {
    id: "complex-power-05-buffered-matrix", category: "power-bus-display", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["esp32-devkit-v1-30pin"], expectedComponentTypes: ["esp32-devkit-v1-30pin", "ws2812b-matrix-8x8", "sn74ahct1g125", "resistor", "dc-supply"],
    prompt: "Build a 5 V powered 8x8 WS2812B matrix sign controlled by the 30-pin ESP32 DevKit V1. Use GPIO18 for the sketch data pin and SN74AHCT1G125 A input, connect its Y output through a 330 ohm series resistor to matrix DIN, OE to GND, and power buffer and matrix from a dedicated 5 V DC supply. Join supply negative, ESP32 ground, buffer GND, and matrix GND. Display a simple custom geometric cluster of green pixels; do not power it from an ESP32 GPIO. Include complete code.",
    requiredNets: [[pin("esp32-devkit-v1-30pin", "GPIO18"), pin("sn74ahct1g125", "A")], [pin("sn74ahct1g125", "Y"), pin("resistor", "1")], [pin("resistor", "2"), pin("ws2812b-matrix-8x8", "DIN")], [pin("dc-supply", "+"), pin("sn74ahct1g125", "VCC"), pin("ws2812b-matrix-8x8", "VDD")], [pin("dc-supply", "-"), pin("esp32-devkit-v1-30pin", "GND", "GND2"), pin("sn74ahct1g125", "GND"), pin("ws2812b-matrix-8x8", "GND")], [pin("esp32-devkit-v1-30pin", "GND", "GND2"), pin("sn74ahct1g125", "OE")]],
    behavior: { description: "Render a visible green matrix pattern through a powered 3.3-to-5 V buffer and series resistor.", requiredSketchPatterns: ["Adafruit_NeoPixel|NeoPixel", "setPixelColor|fill", "show", "18"], evidence: "pixels" },
  },
  {
    id: "complex-power-06-external-servo", category: "power-bus-display", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["arduino-uno"], expectedComponentTypes: ["arduino-uno", "mg996r-servo", "potentiometer", "dc-supply"],
    prompt: "Make a safe externally powered MG996R servo tester on Arduino Uno. Use one potentiometer with SIG on A0 and VCC/GND on 5V/GND; connect servo SIG to D9. Power the MG996R from its own regulated 5 V DC supply rated for at least 2 A, never from the Uno 5V pin, and join supply negative to Uno GND. Map the knob across a bounded 15–165 degree sweep, show the angle over Serial, and include complete runnable code.",
    requiredNets: [[pin("arduino-uno", "A0"), pin("potentiometer", "SIG")], [pin("arduino-uno", "D9"), pin("mg996r-servo", "SIG")], [pin("dc-supply", "+"), pin("mg996r-servo", "VCC")], [pin("dc-supply", "-"), pin("mg996r-servo", "GND"), pin("arduino-uno", "GND", "GND2", "GND3")]],
    behavior: { description: "Drive a bounded servo angle from the knob and report that angle over Serial.", requiredSketchPatterns: ["analogRead", "Servo", "15", "165", "Serial"], evidence: "servo" },
  },
];
