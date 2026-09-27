import type { ComponentPropertyDefinition } from "./catalog.ts";
const number = (label: string, defaultValue: number, min: number, max: number, unit?: string): ComponentPropertyDefinition => ({ label, kind: "number", defaultValue, min, max, unit });
const boolean = (label: string, defaultValue = true): ComponentPropertyDefinition => ({ label, kind: "boolean", defaultValue });
const temperature = number("Temperature", 25, -40, 125, "°C");
const humidity = number("Humidity", 50, 0, 100, "%");
const pressure = number("Pressure", 101325, 30000, 110000, "Pa");
export const SIMULATION_PROPERTIES: Readonly<Record<string, Record<string, ComponentPropertyDefinition>>> = {
  bme280: { temperature: number("Temperature", 25, -40, 85, "°C"), humidity, pressure }, bmp280: { temperature: number("Temperature", 25, -40, 85, "°C"), pressure }, "sht31-dis": { temperature, humidity }, dht22: { temperature, humidity }, ds18b20: { temperature },
  "mpu-6050": { temperature, ax: number("Acceleration X", 0, -157, 157, "m/s²"), ay: number("Acceleration Y", 0, -157, 157, "m/s²"), az: number("Acceleration Z", 9.80665, -157, 157, "m/s²"), gx: number("Angular velocity X", 0, -35, 35, "rad/s"), gy: number("Angular velocity Y", 0, -35, 35, "rad/s"), gz: number("Angular velocity Z", 0, -35, 35, "rad/s") },
  rfm95w: { peerEnabled: boolean("Virtual peer enabled"), peerFrequency: number("Peer frequency", 915000000, 137000000, 1020000000, "Hz"), peerSpreading: number("Peer spreading factor", 7, 6, 12), peerBandwidth: number("Peer bandwidth", 125000, 7800, 500000, "Hz"), peerCoding: number("Peer coding rate denominator", 5, 5, 8), peerCrc: boolean("Peer CRC enabled", false), peerSyncWord: number("Peer sync word", 18, 0, 255), peerRssi: number("Peer signal strength", -60, -140, 0, "dBm"), peerSnr: number("Peer signal to noise", 8, -20, 20, "dB") },
  "xbee-s2c-zigbee-th": { apiMode: number("Host API mode (1 or 2)", 2, 1, 2), baudRate: number("UART baud rate", 9600, 1200, 115200), peerEnabled: boolean("Virtual peer enabled"), panId: number("Network PAN ID", 4660, 0, 65535), peerPanId: number("Peer PAN ID", 4660, 0, 65535), destination: { kind: "string", label: "Peer address", defaultValue: "0013A20000000001" } },
  "dc-supply": { voltage: number("Output voltage", 5, 0, 48, "V"), enabled: boolean("Enabled") },
  "battery-cell": { initialSoc: number("Initial charge", 50, 0, 100, "%"), capacityMah: number("Capacity", 2000, 1, 20000, "mAh"), temperature },
  "dc-load": { resistance: number("Load resistance", 100, 0.01, 1000000, "Ω"), enabled: boolean("Enabled") },
  "ideal-mosfet": { threshold: number("Gate threshold", 2.5, 0.1, 10, "V") },
};
