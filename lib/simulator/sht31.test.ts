import test from "node:test";
import assert from "node:assert/strict";
import { Sht31Model, shtCrc } from "./sht31.ts";

test("SHT31 single-shot timing and Sensirion CRC", () => {
  assert.equal(shtCrc([0xbe, 0xef]), 0x92);
  const sensor = new Sht31Model(); sensor.tick(0, 21.5, 67);
  assert.equal(sensor.write([0x24, 0x00], 0), 0);
  sensor.tick(14, 30, 10); assert.deepEqual(sensor.read(6, 14), []);
  sensor.tick(15, 30, 10); const data = sensor.read(6, 15);
  assert.equal(data.length, 6); assert.equal(shtCrc(data.slice(0, 2)), data[2]); assert.equal(shtCrc(data.slice(3, 5)), data[5]);
  assert.ok(Math.abs(-45 + (data[0] << 8 | data[1]) * 175 / 65535 - 21.5) < 0.01);
  assert.ok(Math.abs((data[3] << 8 | data[4]) * 100 / 65535 - 67) < 0.01);
  assert.deepEqual(sensor.read(6, 15), []);
});

test("SHT31 heater, reset, invalid command and write-checksum flags", () => {
  const sensor = new Sht31Model();
  sensor.write([0x30, 0x6d], 0); assert.equal(sensor.heater, true); assert.ok(sensor.status & 0x2000);
  assert.equal(sensor.write([0x61, 0x1d, 0xcd, 0x33, 0], 0), 3); assert.ok(sensor.status & 1);
  assert.equal(sensor.write([0xff, 0xff], 0), 3); assert.ok(sensor.status & 2);
  sensor.write([0x30, 0xa2], 0); assert.equal(sensor.heater, false); assert.equal(sensor.status, 0x8010);
  sensor.write([0xf3, 0x2d], 1); assert.deepEqual(sensor.read(3, 1), [0x80, 0x10, shtCrc([0x80, 0x10])]);
});

test("SHT31 periodic alert thresholds apply hysteresis and reset restores limits", () => {
  const sensor = new Sht31Model(); sensor.tick(0, 25, 50); sensor.write([0x30, 0x41], 0);
  const limit = (temperature: number, humidity: number) => (Math.round(humidity * 65535 / 100) & 0xfe00) | (Math.round((temperature + 45) * 65535 / 175) >> 7);
  const writeLimit = (command: number, value: number) => sensor.write([0x61, command, value >> 8, value & 255, shtCrc([value >> 8, value & 255])], 0);
  assert.equal(writeLimit(0x1d, limit(30, 90)), 0); assert.equal(writeLimit(0x16, limit(28, 85)), 0);
  sensor.write([0x21, 0x30], 0); sensor.tick(15, 25, 50); assert.equal(sensor.status & 0x8c00, 0);
  sensor.tick(1000, 32, 50); sensor.tick(1015, 32, 50); assert.ok(sensor.status & 0x8400);
  sensor.tick(2000, 29, 50); sensor.tick(2015, 29, 50); assert.ok(sensor.status & 0x8400);
  sensor.tick(3000, 26, 50); sensor.tick(3015, 26, 50); assert.equal(sensor.status & 0x8c00, 0);
  sensor.write([0xe0, 0x00], 3015); assert.equal(sensor.read(6, 3015).length, 6); assert.equal(sensor.read(6, 3015).length, 0);
  sensor.reset(); sensor.write([0xe1, 0x1f], 0); assert.deepEqual(sensor.read(3, 0).slice(0, 2), [0xcd, 0x33]);
});
