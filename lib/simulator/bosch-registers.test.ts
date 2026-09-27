import test from "node:test";
import assert from "node:assert/strict";
import { boschMeasurementRegister } from "./bosch-registers.ts";

// Decode using the floating-point compensation equations, independently of the encoder.
for (const humidityEnabled of [false, true]) {
  test(`${humidityEnabled ? "BME280" : "BMP280"} register calibration recovers changing physical readings`, () => {
    for (const [temperature, pressure, humidity] of [[-40, 30000, 0], [-8, 98000, 23], [25, 101325, 50], [85, 110000, 100]]) {
      const read = (r: number) => boschMeasurementRegister(r, temperature, pressure, humidity, humidityEnabled) ?? 0;
      const u16 = (r: number) => read(r) | read(r + 1) << 8;
      const s16 = (r: number) => (u16(r) << 16) >> 16;
      const adc20 = (r: number) => read(r) * 4096 + read(r + 1) * 16 + (read(r + 2) >> 4);
      const t = adc20(0xfa);
      const v1 = (t / 16384 - u16(0x88) / 1024) * s16(0x8a);
      const v2 = (t / 131072 - u16(0x88) / 8192) ** 2 * s16(0x8c);
      const fine = v1 + v2;
      assert.ok(Math.abs(fine / 5120 - temperature) < 0.01);
      let p1 = fine / 2 - 64000;
      let p2 = p1 * p1 * s16(0x98) / 32768 + p1 * s16(0x96) * 2;
      p2 = p2 / 4 + s16(0x94) * 65536;
      p1 = (s16(0x92) * p1 * p1 / 524288 + s16(0x90) * p1) / 524288;
      p1 = (1 + p1 / 32768) * u16(0x8e);
      let compensated = (1048576 - adc20(0xf7) - p2 / 4096) * 6250 / p1;
      compensated += (s16(0x9e) * compensated * compensated / 2147483648 + compensated * s16(0x9c) / 32768 + s16(0x9a)) / 16;
      assert.ok(Math.abs(compensated - pressure) < 0.2);
      if (humidityEnabled) {
        const adc = read(0xfd) * 256 + read(0xfe);
        const h4 = (read(0xe4) << 4) | (read(0xe5) & 15);
        const h5 = (read(0xe6) << 4) | (read(0xe5) >> 4);
        let h = fine - 76800;
        h = (adc - (h4 * 64 + h5 / 16384 * h)) * (s16(0xe1) / 65536 * (1 + read(0xe7) / 67108864 * h * (1 + read(0xe3) / 67108864 * h)));
        h *= 1 - read(0xa1) * h / 524288;
        assert.ok(Math.abs(h - humidity) < 0.02);
      } else assert.equal(boschMeasurementRegister(0xfd, temperature, pressure, humidity, false), undefined);
    }
  });
}
