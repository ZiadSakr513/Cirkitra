import test from "node:test";
import assert from "node:assert/strict";
import { Bq27441Model } from "./bq27441.ts";

test("fuel gauge command words report measured quantities with actual wire units", () => {
  const gauge = new Bq27441Model(); gauge.update({ voltage: 3.7, current: -0.25, temperature: 25, soc: 40, capacityMah: 2000 });
  assert.equal(gauge.word(4), 3700); assert.equal(gauge.word(16) << 16 >> 16, -250);
  assert.equal(gauge.word(2), 2982); assert.equal(gauge.word(12), 800); assert.equal(gauge.word(28), 40);
  assert.equal(gauge.read(4) | gauge.read(5) << 8, 3700);
  assert.ok(gauge.flags & 1); assert.ok(gauge.flags & 8);
  gauge.update({ voltage: 4.2, current: 0.1, temperature: 65, soc: 100, capacityMah: 2000 });
  assert.ok(gauge.flags & 512); assert.ok(gauge.flags & 0x8000); assert.equal(gauge.flags & 1, 0);
});

test("fuel gauge raw configuration and adapter capacity share one model", () => {
  const gauge = new Bq27441Model(); gauge.update({ voltage: 3.7, current: 0, temperature: 25, soc: 50, capacityMah: 2000 });
  gauge.write(0, 0x13); gauge.write(1, 0); assert.ok(gauge.flags & 16);
  gauge.write(0x3e, 82); gauge.write(0x4a, 0x0b); gauge.write(0x4b, 0xb8);
  gauge.write(0x60, 0); assert.equal(gauge.word(60), 2000, "bad data checksum cannot change design capacity");
  gauge.write(0x60, gauge.read(0x60)); assert.equal(gauge.word(60), 3000); assert.equal(gauge.word(12), 1500);
  gauge.write(0, 0x42); gauge.write(1, 0); assert.equal(gauge.flags & 16, 0);
  assert.equal(gauge.setCapacity(5000), true); assert.equal(gauge.word(12), 2500); assert.equal(gauge.setCapacity(-1), false);
  gauge.write(0, 1); gauge.write(1, 0); assert.equal(gauge.word(0), 0x0421);
  gauge.write(0, 0x41); gauge.write(1, 0); assert.equal(gauge.word(60), 2000);
});
