import test from "node:test";
import assert from "node:assert/strict";
import { XBeeModel, XBeeFrameDecoder, encodeXBeeFrame } from "./xbee.ts";
import type { CircuitComponent } from "../circuit/types.ts";

const radio: CircuitComponent = { id: "radio", type: "xbee-s2c-zigbee-th", label: "Zigbee", x: 0, y: 0 };
const request = (data = [65, 66]) => [0x10, 1, 0, 0x13, 0xa2, 0, 0, 0, 0, 1, 0xff, 0xfe, 0, 0, ...data];
function drain(model: XBeeModel, escaped = true) {
  const decoder = new XBeeFrameDecoder(), frames: number[][] = [];
  while (model.available(true)) { const frame = decoder.push(model.read(true), escaped); if (frame) frames.push(frame); }
  return frames;
}

test("XBee API 1 and escaped API 2 frame encoding includes valid length and checksum", () => {
  for (const escaped of [false, true]) {
    const data = request([0x7e, 0x7d, 0x11, 0x13]), decoder = new XBeeFrameDecoder();
    let result: number[] | undefined;
    for (const byte of encodeXBeeFrame(data, escaped)) result = decoder.push(byte, escaped) ?? result;
    assert.deepEqual(result, data); assert.equal(decoder.error, false);
    const corrupt = encodeXBeeFrame(data, escaped); corrupt[corrupt.length - 1] ^= 1;
    for (const byte of corrupt) decoder.push(byte, escaped);
    assert.equal(decoder.error, true);
  }
});

test("Zigbee association, transmit status and receive API frames progress on simulated time", () => {
  const model = new XBeeModel(); model.tick(radio, 0, true, true); assert.equal(model.associated, false);
  model.tick(radio, 100, true, true); assert.equal(model.associated, true); assert.deepEqual(drain(model), [[0x8a, 2]]);
  model.write(encodeXBeeFrame(request()), radio, 100, true);
  model.tick(radio, 101, true, true); assert.equal(model.packets.length, 0);
  model.tick(radio, 102, true, true); assert.deepEqual(drain(model), [[0x8b, 1, 255, 254, 0, 0, 0]]);
  assert.equal(model.packets[0].payload, "AB");
  assert.equal(model.inject([72, 105], radio, 103, true), true);
  const receive = drain(model)[0]; assert.equal(receive[0], 0x90); assert.deepEqual(receive.slice(12), [72, 105]);
});

test("Zigbee incompatible network, sleep, broken host and wrong destination prevent delivery", () => {
  const model = new XBeeModel(); model.tick(radio, 0, true, true); model.tick(radio, 100, true, true); drain(model);
  assert.equal(model.inject([65], radio, 100, false), false);
  model.tick(radio, 101, true, false); assert.equal(model.inject([65], radio, 101, true), false);
  model.tick(radio, 102, true, true);
  const wrong = request(); wrong[9] = 99; model.write(encodeXBeeFrame(wrong), radio, 102, true); model.tick(radio, 104, true, true);
  assert.equal(drain(model)[0][5], 0x24);
  model.tick({ ...radio, properties: { peerPanId: 99 } }, 105, true, true); assert.equal(model.associated, false);
  assert.equal(model.inject([65], radio, 105, true), false);
  model.tick(radio, 106, false, true); assert.equal(model.available(true), 0); assert.equal(model.packets.length, 0);
});

test("Zigbee local AT reports association and rejects unsupported commands", () => {
  const model = new XBeeModel(); model.tick(radio, 0, true, true);
  model.write(encodeXBeeFrame([8, 1, 65, 73]), radio, 0, true);
  assert.deepEqual(drain(model)[0], [0x88, 1, 65, 73, 0, 0x21]);
  model.write(encodeXBeeFrame([8, 2, 88, 88]), radio, 0, true);
  assert.deepEqual(drain(model)[0], [0x88, 2, 88, 88, 2]);
});
