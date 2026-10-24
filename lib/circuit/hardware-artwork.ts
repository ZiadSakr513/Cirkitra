/** Physical-style artwork kinds for the components introduced by the library expansion. */
export const HARDWARE_ARTWORK_KIND = Object.freeze({
  "neopixel-ring-24": "pixel-ring",
  "ws2812b-strip-30": "pixel-strip-30",
  "ws2812b-strip-60": "pixel-strip-60",
  "ws2812b-matrix-8x8": "pixel-matrix-8x8",
  "capacitor-1uf": "ceramic-capacitor",
  "electrolytic-capacitor-100uf": "electrolytic-capacitor",
  "diode-1n4007": "rectifier-diode",
  "ntc-thermistor-10k": "ntc-bead",
  dht11: "dht11-grille",
  "ds18b20-waterproof": "waterproof-probe",
  "bme280-gy-bme-p280": "bme280-breakout",
  "hc-sr501": "pir-dome-module",
  "mq-2-gas-sensor": "mq2-gas-module",
  "sgp40-voc-sensor": "sgp40-breakout",
  "bme680-gas-sensor": "bme680-breakout",
  "scd41-co2-sensor": "scd41-breakout",
  "mpu-6050-breakout": "mpu6050-breakout",
  "veml7700-light-sensor": "veml7700-breakout",
  "apds-9960-proximity-gesture": "apds9960-breakout",
  "ld2410c-mmwave-radar": "ld2410c-radar-board",
  "vl53l0x-tof-distance": "vl53l0x-breakout",
  "rcwl-0516-microwave-radar": "rcwl0516-board",
  "jsn-sr04t-ultrasonic": "jsn-sr04t-probe",
  "as5600-magnetic-encoder": "as5600-encoder-board",
  "yf-s201-water-flow-sensor": "yf-s201-inline-flow",
  "photoresistor-gl5528": "gl5528-photoresistor",
  "tsop4838-ir-receiver": "tsop4838-receiver",
  "vs1838b-ir-receiver-module": "vs1838b-receiver-module",
  "mg996r-servo": "mg996r-servo",
  "sg90-servo": "sg90-servo",
  "r385-water-pump": "r385-pump",
  "solenoid-valve-12v": "solenoid-valve",
  "l298n-driver-module": "l298n-driver-board",
  "tmc2209-stepper-driver": "tmc2209-driver-board",
  "stepper-28byj-48": "stepper-28byj-48",
  "uln2003-stepper-driver": "uln2003-driver-board",
  "nema17-stepper-17hs4401s": "nema17-17hs4401s",
  "max7219-8x8-matrix": "max7219-matrix-board",
  "sh1107-oled-128x128": "sh1107-oled",
  "tm1637-4-digit-display": "tm1637-display",
  "st7735s-tft-1-8": "st7735s-tft",
  "ili9341-tft-2-8": "ili9341-tft",
  "epaper-2-9-spi": "epaper-2-9",
  "gc9a01-round-tft": "gc9a01-round-tft",
  "battery-9v": "pp3-battery",
  "2n2222-transistor": "npn-to92",
  "pnp-transistor-2n3906": "pnp-to92",
  "n-mosfet-2n7000": "nmos-to92",
  "ne555-timer": "ne555-dip8",
  "dip-switch-8": "dip-switch-8",
  "ky-023-joystick": "ky023-joystick",
  "ir-remote-controller": "nec-ir-remote",
  "breadboard-half": "breadboard-half",
  "breadboard-full": "breadboard-full",
} as const);

export type HardwareArtworkKind = (typeof HARDWARE_ARTWORK_KIND)[keyof typeof HARDWARE_ARTWORK_KIND];

export const HARDWARE_BOARD_ARTWORK_KIND = Object.freeze({
  "esp32-nodemcu-32s": "esp32-nodemcu-32s",
  "esp32-devkit-v1-30pin": "esp32-devkit-v1-30pin",
  "xiao-esp32s3-sense": "xiao-esp32s3-sense",
  "freenove-esp32s3-wroom": "freenove-esp32s3-wroom",
} as const);

export type HardwareBoardArtworkKind = (typeof HARDWARE_BOARD_ARTWORK_KIND)[keyof typeof HARDWARE_BOARD_ARTWORK_KIND];

export function hasHardwareArtwork(type: string): boolean {
  return Object.hasOwn(HARDWARE_ARTWORK_KIND, type) || Object.hasOwn(HARDWARE_BOARD_ARTWORK_KIND, type);
}

export function getHardwareArtworkKind(type: string): HardwareArtworkKind | undefined {
  return (HARDWARE_ARTWORK_KIND as Readonly<Record<string, HardwareArtworkKind>>)[type];
}

export function getHardwareBoardArtworkKind(type: string): HardwareBoardArtworkKind | undefined {
  return (HARDWARE_BOARD_ARTWORK_KIND as Readonly<Record<string, HardwareBoardArtworkKind>>)[type];
}
