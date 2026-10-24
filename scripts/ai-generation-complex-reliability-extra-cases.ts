import type { ComplexReliabilityCase } from "./ai-generation-complex-reliability-cases.ts";

export const COMPLEX_RELIABILITY_EXTRA_SUITE_ID = "complex-reliability-extra-10-v1";

const pin = (componentType: string, ...pins: string[]) => ({ componentType, pins });
const pinAt = (componentType: string, occurrence: number, ...pins: string[]) => ({ componentType, occurrence, pins });

/** Conditional generalization cases: these run only after a failure in the
 * original 30-case suite, and each changes the scenario while targeting a
 * previously observed shared failure family. */
export const COMPLEX_RELIABILITY_EXTRA_CASES: readonly ComplexReliabilityCase[] = [
  {
    id: "complex-extra-01-symbol-ground-climate", category: "sensor-control", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["arduino-uno"], expectedComponentTypes: ["arduino-uno", "dht22", "ssd1306-oled-128x64", "buzzer", "resistor", "ground"],
    prompt: "Build an Arduino Uno climate alert using exactly one DHT22, one SSD1306 I2C OLED, a buzzer, and a DHT data pull-up resistor. Use D4 for DHT DATA; connect the resistor from DATA to 5V. Put the OLED on Uno SDA/SCL, power the DHT22 from 5V and the OLED from a compatible 3.3–5V rail, and use one named Ground symbol as the common return for DHT GND, OLED GND, and buzzer negative. Connect Uno GND to that same common ground. Connect buzzer + to Uno D9 and buzzer - to the common ground. Sound the buzzer above 30 C and show temperature and humidity. Include complete code.",
    requiredNets: [[pin("arduino-uno", "D4"), pin("dht22", "DATA"), pin("resistor", "1")], [pin("resistor", "2"), pin("arduino-uno", "5V")], [pin("arduino-uno", "5V"), pin("dht22", "VDD")], [pin("arduino-uno", "5V", "3V3"), pin("ssd1306-oled-128x64", "VCC")], [pin("arduino-uno", "GND", "GND2", "GND3"), pin("ground", "GND"), pin("dht22", "GND"), pin("ssd1306-oled-128x64", "GND"), pin("buzzer", "-")], [pin("arduino-uno", "SDA", "A4"), pin("ssd1306-oled-128x64", "SDA")], [pin("arduino-uno", "SCL", "A5"), pin("ssd1306-oled-128x64", "SCL")], [pin("arduino-uno", "D9"), pin("buzzer", "+")]],
    behavior: { description: "Display measured climate values and sound the buzzer above 30 C.", requiredSketchPatterns: ["DHT", "30", "digitalWrite|tone", "display"], evidence: "display" },
  },
  {
    id: "complex-extra-02-additive-display-toggle", category: "circuit-preserving-edit", group: "edit", baseCaseId: "complex-extra-01-symbol-ground-climate", minimumBoards: 1,
    expectedBoardTypes: ["arduino-uno"], expectedComponentTypes: ["arduino-uno", "dht22", "ssd1306-oled-128x64", "buzzer", "resistor", "ground", "push-button"],
    prompt: "Edit the open climate alert. Preserve every existing part, component ID, wire ID, common-ground connection, DHT behavior, buzzer threshold, and OLED reading. Add a push button from Uno D7 to the existing common-ground net using INPUT_PULLUP. Each press should toggle the OLED between the temperature page and humidity page; a second press returns to the first page. Keep the buzzer logic independent and provide the updated complete sketch.",
    requiredNets: [[pin("arduino-uno", "D7"), pin("push-button", "1")], [pin("ground", "GND"), pin("push-button", "2")]],
    behavior: { description: "Preserve the climate alarm and toggle the OLED page once per press.", requiredSketchPatterns: ["digitalRead", "INPUT_PULLUP", "temperature|humidity", "display"], evidence: "display" },
  },
  {
    id: "complex-extra-03-xiao-uart-display", category: "multi-board", group: "multi-board", minimumBoards: 2,
    expectedBoardTypes: ["arduino-uno", "xiao-esp32s3-sense"], expectedComponentTypes: ["arduino-uno", "xiao-esp32s3-sense", "ds18b20", "resistor", "sh1107-oled-128x128"],
    prompt: "Create a two-board temperature link. The Arduino Uno reads a DS18B20 on D2 with its dedicated 4.7k pull-up to 5V and sends temperature samples over UART0. The XIAO ESP32-S3 Sense receives on D7/GPIO44, transmits back on D6/GPIO43, and shows the latest reading on an SH1107 OLED connected to D4/D5 I2C. Cross Uno D1 TX to XIAO D7 RX and XIAO D6 TX to Uno D0 RX; join both boards to common ground. Include a complete sketch for each board and keep sampling periodic.",
    requiredNets: [[pin("arduino-uno", "D2"), pin("ds18b20", "DQ"), pin("resistor", "1")], [pin("resistor", "2"), pin("arduino-uno", "5V")], [pin("arduino-uno", "D1"), pin("xiao-esp32s3-sense", "D7", "GPIO44")], [pin("xiao-esp32s3-sense", "D6", "GPIO43"), pin("arduino-uno", "D0")], [pin("arduino-uno", "GND", "GND2", "GND3"), pin("xiao-esp32s3-sense", "GND")], [pin("xiao-esp32s3-sense", "D4"), pin("sh1107-oled-128x128", "SDA")], [pin("xiao-esp32s3-sense", "D5"), pin("sh1107-oled-128x128", "SCL")]],
    behavior: { description: "Send DS18B20 readings over the physical UART and display the received value on the XIAO.", requiredSketchPatterns: ["DallasTemperature|DS18B20", "Serial", "display|print"], evidence: "display" },
  },
  {
    id: "complex-extra-04-motion-uart-indicator", category: "multi-board", group: "multi-board", minimumBoards: 2,
    expectedBoardTypes: ["arduino-mega-2560", "esp32-nodemcu-32s"], expectedComponentTypes: ["arduino-mega-2560", "esp32-nodemcu-32s", "hc-sr501", "led", "resistor"],
    prompt: "Build a two-controller motion indicator. An Arduino Mega 2560 reads one HC-SR501 OUT on D2 and sends a one-byte motion state over Serial1 UART1. Cross Mega D18 TX to ESP32 NodeMCU-32S GPIO3 RX and ESP32 GPIO1 TX back to Mega D19 RX; connect both board grounds together. Power the PIR from Mega 5V/GND. The ESP32 drives a red LED from GPIO18 through its resistor to ground when motion is active. Include separate runnable sketches and verify the LED turns on for motion.",
    requiredNets: [[pin("arduino-mega-2560", "D2"), pin("hc-sr501", "OUT")], [pin("arduino-mega-2560", "5V"), pin("hc-sr501", "VCC")], [pin("arduino-mega-2560", "GND", "GND2", "GND3", "GND4"), pin("hc-sr501", "GND")], [pin("arduino-mega-2560", "D18"), pin("esp32-nodemcu-32s", "GPIO3")], [pin("esp32-nodemcu-32s", "GPIO1"), pin("arduino-mega-2560", "D19")], [pin("arduino-mega-2560", "GND", "GND2", "GND3", "GND4"), pin("esp32-nodemcu-32s", "GND", "GND2", "GND3")], [pin("esp32-nodemcu-32s", "GPIO18"), pin("resistor", "1")], [pin("resistor", "2"), pin("led", "A")]],
    behavior: { description: "Transmit the PIR state and visibly turn on the remote indicator LED.", requiredSketchPatterns: ["Serial1", "digitalRead", "Serial|write", "digitalWrite"], evidence: "digital-output" },
  },
  {
    id: "complex-extra-05-shared-i2c-readout", category: "power-bus-display", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["arduino-mega-2560"], expectedComponentTypes: ["arduino-mega-2560", "bme280-gy-bme-p280", "scd41-co2-sensor", "sh1107-oled-128x128"],
    prompt: "Make an Arduino Mega 2560 environmental display with only a GY-BME/P280 BME280 breakout and an SCD41 CO2 sensor, plus one SH1107 I2C OLED. Put all three on Mega SDA/D20 and SCL/D21, power every module from 3V3, and connect all grounds to Mega GND. Show temperature, humidity, and CO2 ppm on the OLED and print a readable status line over Serial. Use complete code and do not add other sensors.",
    requiredNets: [[pin("arduino-mega-2560", "SDA", "D20"), pin("bme280-gy-bme-p280", "SDA"), pin("scd41-co2-sensor", "SDA"), pin("sh1107-oled-128x128", "SDA")], [pin("arduino-mega-2560", "SCL", "D21"), pin("bme280-gy-bme-p280", "SCL"), pin("scd41-co2-sensor", "SCL"), pin("sh1107-oled-128x128", "SCL")], [pin("arduino-mega-2560", "3V3"), pin("bme280-gy-bme-p280", "VCC"), pin("scd41-co2-sensor", "VDD"), pin("sh1107-oled-128x128", "VCC")], [pin("arduino-mega-2560", "GND", "GND2", "GND3", "GND4"), pin("bme280-gy-bme-p280", "GND"), pin("scd41-co2-sensor", "GND"), pin("sh1107-oled-128x128", "GND")]],
    behavior: { description: "Read both I2C sensors and render their environment values on the OLED.", requiredSketchPatterns: ["BME280|Adafruit_BME280", "SCD41|CO2", "Wire", "display"], evidence: "display" },
  },
  {
    id: "complex-extra-06-mega-joystick-stepper", category: "robotics-motion", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["arduino-nano-classic"], expectedComponentTypes: ["arduino-nano-classic", "ky-023-joystick", "uln2003-stepper-driver", "stepper-28byj-48"],
    prompt: "Build a joystick-operated indexer using one 28BYJ-48 unipolar stepper motor on an Arduino Nano Classic with a KY-023 joystick and ULN2003 driver. Wire joystick VRX to A0 and power it from 5V/GND. Wire ULN2003 IN1-IN4 to D3-D6, its GND to Nano GND, COM and motor COM to Nano 5V, and motor coils A-D to OUT1-OUT4. Center should hold position; move the stick left or right to sequence the four coils in opposite directions. Supply runnable code.",
    requiredNets: [[pin("arduino-nano-classic", "A0"), pin("ky-023-joystick", "VRX")], [pin("arduino-nano-classic", "D3"), pin("uln2003-stepper-driver", "IN1")], [pin("arduino-nano-classic", "D4"), pin("uln2003-stepper-driver", "IN2")], [pin("arduino-nano-classic", "D5"), pin("uln2003-stepper-driver", "IN3")], [pin("arduino-nano-classic", "D6"), pin("uln2003-stepper-driver", "IN4")], [pin("arduino-nano-classic", "GND", "GND2"), pin("ky-023-joystick", "GND"), pin("uln2003-stepper-driver", "GND")], [pin("arduino-nano-classic", "5V"), pin("ky-023-joystick", "VCC"), pin("uln2003-stepper-driver", "COM"), pin("stepper-28byj-48", "COM")], [pin("uln2003-stepper-driver", "OUT1"), pin("stepper-28byj-48", "A")], [pin("uln2003-stepper-driver", "OUT2"), pin("stepper-28byj-48", "B")], [pin("uln2003-stepper-driver", "OUT3"), pin("stepper-28byj-48", "C")], [pin("uln2003-stepper-driver", "OUT4"), pin("stepper-28byj-48", "D")]],
    behavior: { description: "Sequence the four stepper coils differently for left and right joystick movement.", requiredSketchPatterns: ["analogRead", "digitalWrite", "IN1|IN2|step|sequence"], evidence: "joystick-stepper" },
  },
  {
    id: "complex-extra-07-dual-servo-preset", category: "robotics-motion", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["arduino-mega-2560"], expectedComponentTypes: ["arduino-mega-2560", "sg90-servo", "potentiometer", "dc-supply"],
    prompt: "Create a two-axis pan-and-tilt mount on an Arduino Mega 2560 with exactly two SG90 servos and two independent potentiometers. Connect servo SIG pins to D9/D10 and potentiometer SIG pins to A0/A1. Power both servos from one separate regulated 5V DC supply, tie supply negative to Mega GND, and power both potentiometers from Mega 5V/GND. Map each knob independently to 15-165 degrees and include complete code.",
    requiredNets: [[pin("arduino-mega-2560", "D9"), pinAt("sg90-servo", 0, "SIG")], [pin("arduino-mega-2560", "D10"), pinAt("sg90-servo", 1, "SIG")], [pin("arduino-mega-2560", "A0"), pinAt("potentiometer", 0, "SIG")], [pin("arduino-mega-2560", "A1"), pinAt("potentiometer", 1, "SIG")], [pin("dc-supply", "+"), pinAt("sg90-servo", 0, "VCC"), pinAt("sg90-servo", 1, "VCC")], [pin("dc-supply", "-"), pin("arduino-mega-2560", "GND", "GND2", "GND3", "GND4"), pinAt("sg90-servo", 0, "GND"), pinAt("sg90-servo", 1, "GND")], [pin("arduino-mega-2560", "5V"), pinAt("potentiometer", 0, "VCC"), pinAt("potentiometer", 1, "VCC")], [pin("arduino-mega-2560", "GND", "GND2", "GND3", "GND4"), pinAt("potentiometer", 0, "GND"), pinAt("potentiometer", 1, "GND")]],
    behavior: { description: "Attach both servo axes and map each knob to an independent bounded angle.", requiredSketchPatterns: ["analogRead", "Servo", "15", "165", "write"], evidence: "servo" },
  },
  {
    id: "complex-extra-08-preserved-servo-center", category: "circuit-preserving-edit", group: "edit", baseCaseId: "complex-extra-07-dual-servo-preset", minimumBoards: 1,
    expectedBoardTypes: ["arduino-mega-2560"], expectedComponentTypes: ["arduino-mega-2560", "sg90-servo", "potentiometer", "dc-supply", "push-button"],
    prompt: "Edit the open pan-and-tilt mount. Preserve both SG90 servos, both potentiometers, the external supply, every component ID and wire, and both existing pin assignments. Add a push button from Mega D4 to GND with INPUT_PULLUP. A press should toggle a persistent center-lock state; in center lock both axes stay at 90 degrees, and the next press restores independent knob tracking. Do not rebuild the project; return the updated sketches.",
    requiredNets: [[pin("arduino-mega-2560", "D4"), pin("push-button", "1")], [pin("arduino-mega-2560", "GND", "GND2", "GND3", "GND4"), pin("push-button", "2")]],
    behavior: { description: "Preserve the two axes and add a persistent press-toggle center lock.", requiredSketchPatterns: ["digitalRead", "INPUT_PULLUP", "Servo", "center|90"], evidence: "servo" },
  },
  {
    id: "complex-extra-09-esp32-matrix", category: "power-bus-display", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["esp32-devkit-v1-30pin"], expectedComponentTypes: ["esp32-devkit-v1-30pin", "max7219-8x8-matrix"],
    prompt: "Build an ESP32 DevKit V1 30-pin MAX7219 8x8 matrix counter. Connect DIN to GPIO23 MOSI, CLK to GPIO18 SCK, and CS to GPIO5; power the matrix from 5V and GND. Use SPI.transfer with a complete MAX7219 register initialization: no decode, scan limit seven, nonzero intensity, and shutdown register set to one. Then write a visible moving bar to row registers 1-8, toggling CS around every two-byte register frame. Include a complete runnable sketch.",
    requiredNets: [[pin("esp32-devkit-v1-30pin", "GPIO23", "MOSI"), pin("max7219-8x8-matrix", "DIN")], [pin("esp32-devkit-v1-30pin", "GPIO18", "SCK"), pin("max7219-8x8-matrix", "CLK")], [pin("esp32-devkit-v1-30pin", "GPIO5", "SS"), pin("max7219-8x8-matrix", "CS")], [pin("esp32-devkit-v1-30pin", "5V"), pin("max7219-8x8-matrix", "VCC")], [pin("esp32-devkit-v1-30pin", "GND", "GND2"), pin("max7219-8x8-matrix", "GND")]],
    behavior: { description: "Initialize and render a visible moving pattern on the MAX7219 matrix.", requiredSketchPatterns: ["SPI\\.transfer", "digitalWrite", "0x0[cC]|12", "0x0[bB]|11", "0x0[aA]|10"], evidence: "matrix" },
  },
  {
    id: "complex-extra-10-buffered-pixel-strip", category: "power-bus-display", group: "single-board", minimumBoards: 1,
    expectedBoardTypes: ["esp32-nodemcu-32s"], expectedComponentTypes: ["esp32-nodemcu-32s", "ws2812b-strip-8", "sn74ahct1g125", "resistor", "dc-supply"],
    prompt: "Build a safe 5V addressable status strip on an ESP32 NodeMCU-32S. Use GPIO19 for both the sketch's NeoPixel data pin and SN74AHCT1G125 A. Power the buffer and eight-pixel WS2812B strip from a separate 5V DC supply; set OE low, connect buffer Y through a 330 ohm series resistor to strip DIN, and connect supply negative, ESP32 GND, buffer GND, and strip GND together. Show a visible blue startup pattern and then blink red on alternate seconds. Include complete code.",
    requiredNets: [[pin("esp32-nodemcu-32s", "GPIO19"), pin("sn74ahct1g125", "A")], [pin("sn74ahct1g125", "Y"), pin("resistor", "1")], [pin("resistor", "2"), pin("ws2812b-strip-8", "DIN")], [pin("dc-supply", "+"), pin("sn74ahct1g125", "VCC"), pin("ws2812b-strip-8", "VDD")], [pin("dc-supply", "-"), pin("esp32-nodemcu-32s", "GND", "GND2", "GND3"), pin("sn74ahct1g125", "GND"), pin("ws2812b-strip-8", "GND")], [pin("esp32-nodemcu-32s", "GND", "GND2", "GND3"), pin("sn74ahct1g125", "OE")]],
    behavior: { description: "Drive visible strip pixels through the powered and enabled logic buffer.", requiredSketchPatterns: ["Adafruit_NeoPixel", "setPixelColor", "show", "19"], evidence: "pixels" },
  },
];
