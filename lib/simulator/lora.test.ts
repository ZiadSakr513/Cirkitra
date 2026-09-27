import test from "node:test";
import assert from "node:assert/strict";
import { LoRaModel } from "./lora.ts";
import type { CircuitComponent, ComponentProperties } from "../circuit/types.ts";

const radio: CircuitComponent = { id: "radio", type: "rfm95w", label: "Radio", x: 0, y: 0 };

test("LoRa transmission completes only on the simulated clock", () => {
  const model = new LoRaModel(); assert.equal(model.begin(915000000, radio, 0), 1);
  model.beginPacket(false, radio, 0); assert.equal(model.append([65, 66, 67], radio, 0), 3);
  model.write(1, 0x83, radio, 0); assert.equal(model.packets.length, 0);
  model.tick(2); assert.equal(model.packets.length, 0);
  model.tick(3); assert.equal(model.packets[0].payload, "ABC"); assert.match(model.packets[0].status, /Delivered/); assert.equal(model.txDone, true);
  model.write(0x12, 8, radio, 3); assert.equal(model.txDone, false);
  model.reset(); assert.equal(model.packets.length, 0); assert.equal(model.initialized, false);
});

test("LoRa SPI FIFO and high-level packet reads share one buffer", () => {
  const model = new LoRaModel(); model.begin(915000000, radio, 0); model.write(1, 0x85, radio, 0);
  assert.equal(model.inject([72, 105], radio, 1, true), true);
  assert.equal(model.read(0x13), 2); assert.equal(model.read(0), 72); assert.equal(model.byte(), 105); assert.equal(model.byte(), -1);
  model.write(0x0d, 0, radio, 1); assert.equal(model.parse(0, radio, 1), 2); assert.equal(model.byte(true), 72); assert.equal(model.byte(), 72);
  assert.equal(model.inject([88], radio, 2, true), false, "parsePacket places the radio in standby");
});

test("LoRa rejects incompatible peers, sleeping radios and disconnected hosts", () => {
  const model = new LoRaModel(); model.begin(915000000, radio, 0);
  model.write(1, 0x85, radio, 0);
  for (const properties of ([{ peerFrequency: 868000000 }, { peerBandwidth: 250000 }, { peerSpreading: 9 }, { peerCoding: 8 }, { peerCrc: true }, { peerSyncWord: 52 }, { peerEnabled: false }] as ComponentProperties[])) assert.equal(model.inject([65], { ...radio, properties }, 0, true), false);
  assert.equal(model.inject([65], radio, 0, false), false);
  model.write(1, 0x80, radio, 0); assert.equal(model.inject([65], radio, 0, true), false);
  model.write(1, 0x85, radio, 0); assert.equal(model.inject([65], radio, 0, true), true);
  assert.equal(model.inject([66], radio, 0, true), false, "unread packet must not be silently overwritten");
});

test("LoRa packet size and direct SPI configuration are enforced", () => {
  const model = new LoRaModel(); model.begin(915000000, radio, 0); model.beginPacket(false, radio, 0);
  assert.equal(model.append(Array(300).fill(65), radio, 0), 255);
  model.write(0x1d, 0x92, radio, 0); assert.equal(model.bandwidth, 500000);
  model.write(1, 0x83, radio, 0); model.tick(255); assert.match(model.packets[0].status, /incompatible/);
});
