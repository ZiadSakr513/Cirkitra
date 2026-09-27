/** Virtual factory calibration with linear coefficients compatible with Bosch's compensation formulas. */
export function boschMeasurementRegister(register: number, temperature: number, pressure: number, humidity: number, hasHumidity: boolean): number | undefined {
  // T1=T2=16384, T3=0; P1=32768, P2..P9=0; H2=1024, other humidity coefficients=0.
  // These are calibration constants, not fixed sensor readings: ADC values below vary with the environment.
  const calibration: Record<number, number> = { 0x88: 0, 0x89: 0x40, 0x8a: 0, 0x8b: 0x40, 0x8e: 0, 0x8f: 0x80, 0xe1: 0, 0xe2: 4 };
  if ((register >= 0x88 && register <= 0xa1) || (hasHumidity && register >= 0xe1 && register <= 0xe7)) return calibration[register] ?? 0;
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const adcT = Math.round(clamp(temperature, -40, 85) * 5120 + 262144);
  const adcP = Math.round(1048576 - clamp(pressure, 30000, 110000) * 32768 / 6250);
  const adcH = Math.round(clamp(humidity, 0, 100) * 64);
  const data = [adcP >> 12, adcP >> 4 & 255, (adcP & 15) << 4, adcT >> 12, adcT >> 4 & 255, (adcT & 15) << 4, adcH >> 8, adcH & 255];
  if (register >= 0xf7 && register <= (hasHumidity ? 0xfe : 0xfc)) return data[register - 0xf7];
  return undefined;
}
