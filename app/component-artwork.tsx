import { type ReactNode } from "react";
import type { SimulatedComponentState, SimulatorStatus } from "../lib/simulator/types.ts";
import {
  getHardwareArtworkKind,
  getHardwareBoardArtworkKind,
  type HardwareArtworkKind as Kind,
  type HardwareBoardArtworkKind as BoardKind,
} from "../lib/circuit/hardware-artwork.ts";
import { expandHorizontalHeader } from "../lib/circuit/header-spacing.ts";
import { artworkActuatorEnergized, artworkDisplayLines, artworkFlowing, artworkJoystickOffset, artworkSpiActivityLines, artworkStepperAngle } from "../lib/circuit/artwork-state.ts";

type ArtworkProps = { type: string; state?: SimulatedComponentState; preview?: boolean; servoAngle?: number; simulationStatus?: SimulatorStatus };
const gold = "#d5b86d";
const pcb = "#17675f";
const trace = "#78c9ae";
const ink = "#142128";
const metal = "#aeb9bc";
const stableSvgNumber = (value: number) => Number(value.toFixed(4));

function Header({ x, y, count, vertical = true, spacing }: { x: number; y: number; count: number; vertical?: boolean; spacing?: number }) {
  const requestedSpacing = spacing ?? (vertical ? 8 : 10);
  const layout = vertical ? { x, spacing: requestedSpacing } : expandHorizontalHeader(x, count, requestedSpacing);
  return <g fill={gold} stroke="#5c5034" strokeWidth="1">
    {Array.from({ length: count }, (_, index) => <circle key={index} cx={vertical ? x : layout.x + index * layout.spacing} cy={vertical ? y + index * requestedSpacing : y} r="2.2" />)}
  </g>;
}

function Breakout({ color = pcb, children, label }: { color?: string; children: import("react").ReactNode; label: string }) {
  return <g>
    <rect x="24" y="24" width="172" height="102" rx="8" fill={color} stroke="#76b7a3" strokeWidth="3" />
    <circle cx="34" cy="34" r="4" fill={ink} stroke="#a2baa9" />
    <circle cx="186" cy="34" r="4" fill={ink} stroke="#a2baa9" />
    <circle cx="34" cy="116" r="4" fill={ink} stroke="#a2baa9" />
    <circle cx="186" cy="116" r="4" fill={ink} stroke="#a2baa9" />
    <path d="M34 48h25v12m127-12h-22v15M36 97h28V82m122 15h-24V83" fill="none" stroke={trace} strokeWidth="2" opacity=".7" />
    {children}
    <text x="110" y="119" fill="#c5e6d8" fontSize="7" fontFamily="monospace" textAnchor="middle">{label}</text>
  </g>;
}

function PixelArt({ kind, state }: { kind: Kind; state?: SimulatedComponentState }) {
  const pixels = state?.pixels ?? [];
  const colorAt = (index: number) => {
    const pixel = pixels[index];
    return pixel && (pixel.r || pixel.g || pixel.b) ? `rgb(${pixel.r},${pixel.g},${pixel.b})` : "#18252b";
  };
  if (kind === "pixel-ring") return <g>
    <circle cx="110" cy="76" r="48" fill="#141d22" stroke="#77878c" strokeWidth="8" />
    <circle cx="110" cy="76" r="29" fill="#090f13" stroke="#26363b" strokeWidth="2" />
    {Array.from({ length: 24 }, (_, index) => {
      const angle = (index * Math.PI * 2) / 24 - Math.PI / 2;
      return <circle key={index} cx={stableSvgNumber(110 + Math.cos(angle) * 39)} cy={stableSvgNumber(76 + Math.sin(angle) * 39)} r="4.2" fill={colorAt(index)} stroke="#91a7ae" strokeWidth="1" />;
    })}
    <Header x={50} y={131} count={4} vertical={false} />
  </g>;
  if (kind === "pixel-strip-30" || kind === "pixel-strip-60") {
    const count = kind === "pixel-strip-30" ? 10 : 18;
    return <g>
      <rect x="16" y="49" width="188" height="54" rx="8" fill="#182127" stroke="#b7a981" strokeWidth="2" />
      <path d="M24 59h170m-170 34h170" stroke="#b43c44" strokeWidth="2" />
      {Array.from({ length: count }, (_, index) => <g key={index}>
        <rect x={27 + index * (150 / Math.max(1, count - 1))} y="63" width="13" height="26" rx="3" fill={colorAt(index)} stroke="#c6d1c8" strokeWidth="1.5" />
        <path d={`M${33 + index * (150 / Math.max(1, count - 1))} 67v17`} stroke="#ffffff70" strokeWidth="1" />
      </g>)}
      <path d="M16 64h13m-13 24h13m162-24h13m-13 24h13" stroke={gold} strokeWidth="3" />
      <g fill={gold} stroke="#5c5034" strokeWidth="1"><circle cx="16" cy="64" r="3" /><circle cx="16" cy="88" r="3" /><circle cx="204" cy="64" r="3" /><circle cx="204" cy="88" r="3" /></g>
      <text x="110" y="119" textAnchor="middle" fill="#ded8b6" fontSize="8" fontFamily="monospace">WS2812B · {kind.endsWith("30") ? "30" : "60"} PX</text>
    </g>;
  }
  if (kind === "pixel-matrix-8x8") return <g>
    <rect x="34" y="15" width="152" height="122" rx="8" fill="#172126" stroke="#78888c" strokeWidth="3" />
    {Array.from({ length: 64 }, (_, index) => <rect key={index} x={51 + (index % 8) * 16} y={27 + Math.floor(index / 8) * 13} width="9" height="8" rx="2" fill={colorAt(index)} stroke="#8da3a6" strokeWidth=".8" />)}
    <Header x={66} y={142} count={4} vertical={false} />
  </g>;
  return null;
}

function BreadboardArt({ full }: { full: boolean }) {
  const rows = full ? 63 : 30;
  const boardHeight = full ? 414 : 244;
  const bottom = 8 + boardHeight;
  const topRailY = 18;
  const bottomRailY = bottom - 24;
  const firstRowY = 44;
  const lastRowY = bottom - 44;
  const channelHeight = lastRowY - firstRowY + 12;
  return <g>
    <rect x="17" y="8" width="186" height={boardHeight} rx="7" fill="#d9d9d0" stroke="#f4f3e9" strokeWidth="4" />
    <rect x="25" y={topRailY} width="170" height="12" rx="3" fill="#f1eee4" />
    <path d={`M31 ${topRailY + 5}h158`} stroke="#c43e43" strokeWidth="2" />
    <rect x="25" y={bottomRailY} width="170" height="12" rx="3" fill="#f1eee4" />
    <path d={`M31 ${bottomRailY + 5}h158`} stroke="#3b70b8" strokeWidth="2" />
    <rect x="29" y={firstRowY - 6} width="72" height={channelHeight} fill="#eeede5" />
    <rect x="119" y={firstRowY - 6} width="72" height={channelHeight} fill="#eeede5" />
    {Array.from({ length: rows }, (_, index) => <g key={index} fill="#52616a">
      {Array.from({ length: 5 }, (_, column) => <circle key={column} cx={39 + column * 14} cy={firstRowY + index * ((lastRowY - firstRowY) / (rows - 1))} r={full ? 1.35 : 1.45} />)}
      {Array.from({ length: 5 }, (_, column) => <circle key={column} cx={129 + column * 14} cy={firstRowY + index * ((lastRowY - firstRowY) / (rows - 1))} r={full ? 1.35 : 1.45} />)}
    </g>)}
    <rect x="105" y={firstRowY - 8} width="12" height={channelHeight + 4} rx="3" fill="#aaa99f" />
    <path d={`M110 ${firstRowY - 4}v${channelHeight - 4}`} stroke="#6b6d6b" strokeDasharray="2 4" />
    <text x="110" y={bottom - 7} textAnchor="middle" fill="#687073" fontSize={full ? "6" : "7"} fontFamily="monospace">{full ? "830 TIE POINTS" : "400 TIE POINTS"}</text>
  </g>;
}

function BoardArt({ kind }: { kind: BoardKind }) {
  if (kind === "xiao-esp32s3-sense") return <g>
    <rect x="54" y="17" width="112" height="207" rx="12" fill="#176e63" stroke="#a3b7a6" strokeWidth="4" />
    <rect x="91" y="6" width="38" height="18" rx="8" fill="#c4cecb" stroke="#e4e8e2" strokeWidth="2" />
    <path d="M97 12h26" stroke="#687a7d" strokeWidth="3" />
    {Array.from({ length: 7 }, (_, index) => <g key={index} fill={gold} stroke="#55472b"><circle cx="55" cy={43 + index * 25} r="3.2" /><circle cx="165" cy={43 + index * 25} r="3.2" /></g>)}
    <rect x="72" y="39" width="76" height="55" rx="5" fill="#b9c2c0" stroke="#e3e5df" strokeWidth="3" />
    <text x="110" y="63" textAnchor="middle" fill="#34454a" fontSize="9" fontFamily="monospace">ESP32-S3</text>
    <text x="110" y="80" textAnchor="middle" fill="#5c6c70" fontSize="6" fontFamily="monospace">N8R8 · Wi-Fi</text>
    <rect x="69" y="105" width="82" height="74" rx="5" fill="#11191d" stroke="#78888b" strokeWidth="3" />
    <circle cx="110" cy="140" r="27" fill="#232d32" stroke="#a9b7b7" strokeWidth="3" />
    <circle cx="110" cy="140" r="17" fill="#0a1117" stroke="#5c7881" strokeWidth="3" />
    <circle cx="110" cy="140" r="8" fill="#80c7de" stroke="#c9e8ec" strokeWidth="2" />
    <circle cx="110" cy="140" r="3" fill="#07131a" />
    <text x="110" y="173" textAnchor="middle" fill="#d5f1df" fontSize="6" fontFamily="monospace">OV2640 CAMERA</text>
    <rect x="81" y="190" width="58" height="13" rx="2" fill="#c7b178" stroke="#efe1b5" strokeWidth="2" />
    <path d="M86 193v7m8-7v7m8-7v7m8-7v7m8-7v7m8-7v7m8-7v7" stroke="#766b50" strokeWidth="1.3" />
    <circle cx="70" cy="213" r="3" fill="#dc6558" /><circle cx="150" cy="213" r="3" fill="#72dba9" />
  </g>;
  if (kind === "esp32-devkit-v1-30pin") return <g>
    <rect x="41" y="8" width="138" height="351" rx="8" fill="#243238" stroke="#81949a" strokeWidth="4" />
    {Array.from({ length: 15 }, (_, index) => <g key={index} fill={gold} stroke="#51472e"><circle cx="42" cy={24 + index * 22.8} r="3.2" /><circle cx="178" cy={24 + index * 22.8} r="3.2" /></g>)}
    <rect x="60" y="62" width="100" height="119" rx="5" fill="#9ba5a5" stroke="#e0e5df" strokeWidth="3" />
    <path d="M67 69h86v15H67z" fill="#c2c9c6" />
    <text x="110" y="111" textAnchor="middle" fill="#36454a" fontSize="9" fontFamily="monospace">ESP-WROOM-32</text>
    <text x="110" y="128" textAnchor="middle" fill="#506166" fontSize="6" fontFamily="monospace">2.4 GHz · PCB ANTENNA</text>
    <path d="M77 73v7m8-7v7m8-7v7m8-7v7m8-7v7m8-7v7m8-7v7m8-7v7" stroke="#717f80" strokeWidth="1.5" />
    <rect x="82" y="203" width="56" height="33" rx="4" fill="#121a1e" stroke="#7d8d91" strokeWidth="2" />
    <text x="110" y="223" textAnchor="middle" fill="#d6e2dc" fontSize="7" fontFamily="monospace">CP2102</text>
    <rect x="71" y="251" width="29" height="25" rx="3" fill="#111a1e" stroke="#67777a" strokeWidth="2" />
    <text x="85" y="267" textAnchor="middle" fill="#bbc9c4" fontSize="5">AMS1117</text>
    <rect x="120" y="250" width="18" height="21" rx="4" fill="#d7d8cf" stroke="#8e9997" strokeWidth="2" />
    <text x="129" y="283" textAnchor="middle" fill="#d8e4df" fontSize="5" fontFamily="monospace">EN</text>
    <circle cx="151" cy="241" r="4" fill="#dc6558" /><circle cx="151" cy="259" r="4" fill="#72dba9" />
    <rect x="85" y="342" width="50" height="19" rx="4" fill="#abb7b9" stroke="#e6ebe7" strokeWidth="2" />
    <rect x="92" y="346" width="36" height="10" rx="2" fill="#253238" />
    <text x="110" y="317" textAnchor="middle" fill="#bdd2cb" fontSize="7" fontFamily="monospace">DOIT · DEVKIT V1</text>
  </g>;
  if (kind === "esp32-nodemcu-32s") return <g>
    <rect x="34" y="8" width="152" height="427" rx="10" fill="#17695e" stroke="#8dbca9" strokeWidth="4" />
    {Array.from({ length: 19 }, (_, index) => <circle key={`l${index}`} cx="35" cy={25 + index * (390 / 18)} r="3.1" fill={gold} stroke="#55472b" />)}
    {Array.from({ length: 19 }, (_, index) => <circle key={`r${index}`} cx="185" cy={25 + index * (390 / 18)} r="3.1" fill={gold} stroke="#55472b" />)}
    <rect x="56" y="54" width="108" height="145" rx="7" fill="#a8b3b2" stroke="#e6e9e1" strokeWidth="3" />
    <path d="M65 64h90v24H65z" fill="#d0d7d2" />
    {Array.from({ length: 7 }, (_, index) => <path key={index} d={`M${70 + index * 12} 70v12`} stroke="#7f9091" strokeWidth="2" />)}
    <text x="110" y="118" textAnchor="middle" fill="#35464a" fontSize="9" fontFamily="monospace">ESP-WROOM-32</text>
    <text x="110" y="136" textAnchor="middle" fill="#596b6f" fontSize="6" fontFamily="monospace">NodeMCU-32S · 2.4 GHz</text>
    <rect x="74" y="153" width="72" height="30" rx="4" fill="#182126" stroke="#64767a" strokeWidth="2" />
    <path d="M82 166h56m-50 7h44" stroke="#6bb8a1" strokeWidth="2" />
    <rect x="77" y="229" width="66" height="36" rx="4" fill="#111a1e" stroke="#7c8d8e" strokeWidth="2" />
    <text x="110" y="251" textAnchor="middle" fill="#c8d5cf" fontSize="7" fontFamily="monospace">CH340C</text>
    <rect x="78" y="286" width="28" height="29" rx="3" fill="#111a1e" stroke="#718184" strokeWidth="2" />
    <text x="92" y="303" textAnchor="middle" fill="#c3d0c8" fontSize="5">3V3</text>
    <rect x="115" y="286" width="18" height="25" rx="4" fill="#dedfd4" stroke="#899695" strokeWidth="2" />
    <text x="124" y="322" textAnchor="middle" fill="#d6e8df" fontSize="5" fontFamily="monospace">EN</text>
    <rect x="141" y="286" width="18" height="25" rx="4" fill="#dedfd4" stroke="#899695" strokeWidth="2" />
    <text x="150" y="322" textAnchor="middle" fill="#d6e8df" fontSize="5" fontFamily="monospace">BOOT</text>
    <circle cx="65" cy="338" r="4" fill="#dc6558" /><circle cx="82" cy="338" r="4" fill="#72dba9" />
    <text x="110" y="382" textAnchor="middle" fill="#d3eadc" fontSize="7" fontFamily="monospace">38-PIN DEVELOPMENT BOARD</text>
    <rect x="83" y="421" width="54" height="22" rx="4" fill="#aeb9ba" stroke="#e5e8e2" strokeWidth="2" />
    <rect x="90" y="426" width="40" height="12" rx="2" fill="#243137" />
  </g>;
  if (kind === "freenove-esp32s3-wroom") return <g>
    <rect x="28" y="7" width="164" height="448" rx="9" fill="#24433d" stroke="#9abca6" strokeWidth="4" />
    {Array.from({ length: 20 }, (_, index) => <g key={index} fill={gold} stroke="#55472b"><circle cx="29" cy={23 + index * (416 / 19)} r="3.1" /><circle cx="191" cy={23 + index * (416 / 19)} r="3.1" /></g>)}
    <rect x="50" y="59" width="120" height="143" rx="7" fill="#aab5b2" stroke="#e5e9e2" strokeWidth="3" />
    <path d="M59 69h102v24H59z" fill="#d0d8d3" />
    {Array.from({ length: 8 }, (_, index) => <path key={index} d={`M${66 + index * 12} 75v12`} stroke="#829191" strokeWidth="2" />)}
    <text x="110" y="124" textAnchor="middle" fill="#37484a" fontSize="8" fontFamily="monospace">ESP32-S3-WROOM</text>
    <text x="110" y="141" textAnchor="middle" fill="#5b6b6a" fontSize="6" fontFamily="monospace">N16R8 · 16 MB FLASH</text>
    <rect x="76" y="160" width="68" height="28" rx="4" fill="#172126" stroke="#718282" strokeWidth="2" />
    <text x="110" y="178" textAnchor="middle" fill="#cad8d1" fontSize="6" fontFamily="monospace">ANTENNA</text>
    <rect x="62" y="226" width="40" height="32" rx="3" fill="#111a1f" stroke="#7d8c8d" strokeWidth="2" />
    <text x="82" y="246" textAnchor="middle" fill="#d6e0d8" fontSize="6" fontFamily="monospace">PSRAM</text>
    <rect x="118" y="226" width="43" height="32" rx="3" fill="#111a1f" stroke="#7d8c8d" strokeWidth="2" />
    <text x="139" y="246" textAnchor="middle" fill="#d6e0d8" fontSize="6" fontFamily="monospace">USB-UART</text>
    <rect x="76" y="279" width="22" height="25" rx="4" fill="#dedfd4" stroke="#899695" strokeWidth="2" />
    <text x="87" y="315" textAnchor="middle" fill="#d6e8df" fontSize="5" fontFamily="monospace">BOOT</text>
    <rect x="122" y="279" width="22" height="25" rx="4" fill="#dedfd4" stroke="#899695" strokeWidth="2" />
    <text x="133" y="315" textAnchor="middle" fill="#d6e8df" fontSize="5" fontFamily="monospace">RESET</text>
    <circle cx="72" cy="339" r="4" fill="#dc6558" /><circle cx="90" cy="339" r="4" fill="#72dba9" />
    <path d="M55 374h110m-110 10h110m-110 10h110" stroke="#80b79e" strokeWidth="2" opacity=".65" />
    <text x="110" y="423" textAnchor="middle" fill="#d5ebdc" fontSize="7" fontFamily="monospace">FREENOVE · ESP32-S3</text>
    <rect x="80" y="435" width="60" height="20" rx="9" fill="#aab6b6" stroke="#e3e7df" strokeWidth="2" />
    <rect x="88" y="440" width="44" height="10" rx="5" fill="#26363b" />
  </g>;
  return null;
}

function SensorArt({ kind }: { kind: Kind }) {
  const standardBoard = (color: string, label: string, chip: string, pins: number) => <Breakout color={color} label={label}>
    <rect x="77" y="46" width="66" height="48" rx="5" fill="#172126" stroke="#92a9a7" strokeWidth="2" />
    <text x="110" y="69" textAnchor="middle" fill="#dce6de" fontSize="8" fontFamily="monospace">{chip}</text>
    <path d="M85 77h50M88 83h44" stroke="#7e9290" strokeWidth="1" />
    <Header x={48} y={132} count={pins} vertical={false} />
  </Breakout>;
  switch (kind) {
    case "dht11-grille": return <g>
      <path d="M66 34q0-10 10-10h68q10 0 10 10v69q0 11-10 11H76q-10 0-10-11z" fill="#e6d4ca" stroke="#fff1e7" strokeWidth="3" />
      <rect x="80" y="41" width="60" height="51" rx="4" fill="#d9c4b9" />
      {Array.from({ length: 4 }, (_, index) => <path key={index} d={`M${88 + index * 14} 47v38`} stroke="#aa9d97" strokeWidth="3" />)}
      <text x="110" y="105" textAnchor="middle" fill="#5d514d" fontSize="8" fontFamily="monospace">DHT11</text>
      <path d="M83 114v26m18-26v26m18-26v26m18-26v26" stroke={metal} strokeWidth="3" />
    </g>;
    case "waterproof-probe": return <g>
      <path d="M32 78C55 78 57 45 83 45h25" fill="none" stroke="#202a30" strokeWidth="7" />
      <rect x="105" y="26" width="87" height="38" rx="18" fill="#b8c1c2" stroke="#eef1ec" strokeWidth="3" />
      <ellipse cx="188" cy="45" rx="7" ry="16" fill="#dce1dd" stroke="#909c9e" strokeWidth="2" />
      <path d="M113 32h57" stroke="#f4f5ef" strokeWidth="2" opacity=".6" />
      <text x="149" y="49" textAnchor="middle" fill="#556267" fontSize="7" fontFamily="monospace">DS18B20</text>
      <path d="M25 78h20" stroke="#c3a966" strokeWidth="4" />
    </g>;
    case "pir-dome-module": return <g>
      <Breakout label="HC-SR501 PIR">
        <path d="M67 78c0-31 19-48 43-48s43 17 43 48v15H67z" fill="#e9e5d7" stroke="#fffdf1" strokeWidth="3" />
        <path d="M76 77q34-24 68 0M81 88q29-19 58 0" fill="none" stroke="#bbb6a8" strokeWidth="2" />
        <circle cx="110" cy="65" r="5" fill="#d1cec3" />
        <Header x={55} y={109} count={3} vertical={false} />
      </Breakout>
    </g>;
    case "mq2-gas-module": return <g>
      <Breakout color="#823c3e" label="MQ-2 · GAS / SMOKE">
        <ellipse cx="110" cy="48" rx="27" ry="13" fill="#c2c7c3" stroke="#eef0e9" strokeWidth="3" />
        <rect x="83" y="48" width="54" height="38" fill="#aeb5b2" stroke="#e5e8e0" strokeWidth="3" />
        {Array.from({ length: 4 }, (_, index) => <path key={index} d={`M${91 + index * 12} 53v29`} stroke="#657277" strokeWidth="3" />)}
        <ellipse cx="110" cy="86" rx="26" ry="8" fill="#535f63" stroke="#b2b8b4" strokeWidth="2" />
        <Header x={64} y={111} count={4} vertical={false} />
      </Breakout>
    </g>;
    case "sgp40-breakout": return standardBoard("#302d58", "SGP40 · VOC", "SGP40", 4);
    case "bme680-breakout": return standardBoard("#284e51", "BME680 · ENV / GAS", "BME680", 6);
    case "scd41-breakout": return <g>{standardBoard("#4d5035", "SCD41 · CO₂", "SCD41", 4)}
      <circle cx="155" cy="46" r="10" fill="#9b9a80" stroke="#e0d8aa" strokeWidth="2" /><circle cx="155" cy="46" r="4" fill="#202a2d" />
    </g>;
    case "bme280-breakout": return standardBoard("#27615a", "GY-BME/P280 · I²C", "BME280", 6);
    case "mpu6050-breakout": return <g>{standardBoard("#226581", "MPU-6050 · ACCEL / GYRO", "MPU6050", 8)}
      <path d="M101 54v-6m18 6v-6m-18 40v6m18-6v6" stroke="#8ce4d0" strokeWidth="2" />
    </g>;
    case "veml7700-breakout": return <g>{standardBoard("#2a4776", "VEML7700 · LIGHT", "VEML7700", 4)}
      <circle cx="158" cy="74" r="12" fill="#81b8d0" stroke="#d4f5ff" strokeWidth="3" /><circle cx="158" cy="74" r="6" fill="#273a49" />
    </g>;
    case "apds9960-breakout": return <g>{standardBoard("#613f65", "APDS-9960 · GESTURE", "APDS9960", 5)}
      <circle cx="156" cy="70" r="13" fill="#161b20" stroke="#c18cdd" strokeWidth="3" /><circle cx="156" cy="70" r="5" fill="#4cc8d9" />
    </g>;
    case "ld2410c-radar-board": return <g>
      <rect x="18" y="32" width="184" height="90" rx="6" fill="#4c604e" stroke="#b7c89b" strokeWidth="3" />
      <rect x="46" y="48" width="128" height="51" rx="6" fill="#a9b5af" stroke="#e4e9e2" strokeWidth="3" />
      <text x="110" y="78" textAnchor="middle" fill="#374849" fontSize="9" fontFamily="monospace">LD2410C</text>
      {Array.from({ length: 8 }, (_, index) => <path key={index} d={`M${57 + index * 15} 53v40`} stroke="#738a86" strokeWidth="2" />)}
      <Header x={43} y={129} count={5} vertical={false} />
      <text x="110" y="114" textAnchor="middle" fill="#d2e2cd" fontSize="7" fontFamily="monospace">24 GHz RADAR</text>
    </g>;
    case "rcwl0516-board": return <g>
      <rect x="33" y="19" width="154" height="120" rx="5" fill="#17684e" stroke="#80bb91" strokeWidth="3" />
      <path d="M50 47q60-42 120 0v25q-60 42-120 0z" fill="none" stroke="#d2c277" strokeWidth="3" />
      <path d="M62 48q48-29 96 0v20q-48 29-96 0z" fill="none" stroke="#d2c277" strokeWidth="2" />
      <rect x="91" y="75" width="39" height="28" rx="3" fill="#172126" stroke="#87ab9b" strokeWidth="2" /><text x="110" y="92" textAnchor="middle" fill="#d4e4df" fontSize="7">BISS0001</text>
      <Header x={55} y={134} count={5} vertical={false} />
    </g>;
    case "vl53l0x-breakout": return <g>
      <Breakout color="#4b315d" label="VL53L0X · TOF">
        <rect x="83" y="43" width="55" height="47" rx="6" fill="#161d24" stroke="#a583be" strokeWidth="3" />
        <circle cx="110" cy="65" r="14" fill="#35294b" stroke="#b29ad0" strokeWidth="3" /><circle cx="110" cy="65" r="7" fill="#111820" />
        <Header x={61} y={108} count={6} vertical={false} />
      </Breakout>
    </g>;
    case "jsn-sr04t-probe": return <g>
      <rect x="18" y="21" width="67" height="100" rx="7" fill="#234b86" stroke="#8aadd3" strokeWidth="3" />
      <text x="51" y="39" textAnchor="middle" fill="#dceafa" fontSize="7" fontFamily="monospace">JSN-SR04T</text>
      <Header x={32} y={51} count={4} />
      <path d="M84 66h36c18 0 18 44 41 44" fill="none" stroke="#222a30" strokeWidth="6" />
      <rect x="152" y="86" width="49" height="37" rx="18" fill="#aeb6b7" stroke="#e2e5e0" strokeWidth="3" />
      <ellipse cx="196" cy="104" rx="6" ry="16" fill="#d9dfdc" stroke="#7e8b8e" strokeWidth="2" />
      <text x="175" y="109" textAnchor="middle" fill="#5b686d" fontSize="6">SEALED</text>
    </g>;
    case "as5600-encoder-board": return <g>
      <Breakout color="#185c73" label="AS5600 · MAGNETIC ANGLE">
        <circle cx="110" cy="70" r="34" fill="#2b3438" stroke="#b3c3c3" strokeWidth="3" />
        <circle cx="110" cy="70" r="22" fill="#8e9c9d" stroke="#e3e7df" strokeWidth="3" />
        <circle cx="110" cy="70" r="10" fill="#222b2f" stroke="#d3bd7b" strokeWidth="2" />
        <path d="M110 48v-9m0 62v-9m-22-22h-9m62 0h-9" stroke="#d4b968" strokeWidth="2" />
        <Header x={48} y={132} count={6} vertical={false} />
      </Breakout>
    </g>;
    default: return null;
  }
}

function SensorPackage({ kind }: { kind: Kind }) {
  switch (kind) {
    case "ntc-bead": return <g>
      <path d="M81 97 91 63m48 34-10-34" stroke={metal} strokeWidth="4" />
      <ellipse cx="110" cy="52" rx="24" ry="28" fill="#1b1e20" stroke="#9aa1a1" strokeWidth="3" />
      <path d="M94 48q16-14 32 0m-29 8q13-11 26 0" fill="none" stroke="#d7b45c" strokeWidth="2" />
    </g>;
    case "gl5528-photoresistor": return <g>
      <path d="M94 97v37m32-37v37" stroke={metal} strokeWidth="4" />
      <ellipse cx="110" cy="52" rx="30" ry="31" fill="#1a2227" stroke="#9caaa8" strokeWidth="3" />
      <circle cx="110" cy="49" r="19" fill="#cda550" stroke="#f1d58f" strokeWidth="3" />
      <path d="M97 40h26m-31 9h36m-32 9h28m-20-18v29m10-29v29" stroke="#6c5028" strokeWidth="2" />
    </g>;
    case "tsop4838-receiver": return <g>
      <path d="M88 84v48m22-48v48m22-48v48" stroke={metal} strokeWidth="4" />
      <path d="M83 36q0-8 8-8h38q8 0 8 8v47H83z" fill="#10171c" stroke="#65777d" strokeWidth="3" />
      <path d="M90 37h40v38H90z" fill="#252e34" /><text x="110" y="60" textAnchor="middle" fill="#d1d9d5" fontSize="7" fontFamily="monospace">38 kHz</text>
    </g>;
    case "vs1838b-receiver-module": return <g>
      <rect x="39" y="51" width="142" height="57" rx="6" fill="#1a6172" stroke="#81bcc1" strokeWidth="3" />
      <path d="M86 69q0-8 8-8h35v30H94q-8 0-8-8z" fill="#11181e" stroke="#66777a" strokeWidth="2" />
      <text x="110" y="81" textAnchor="middle" fill="#d0dedc" fontSize="7">VS1838B</text>
      <Header x={82} y={121} count={3} vertical={false} />
    </g>;
    default: return null;
  }
}

function ServoHorn({ variant, angle, cx, cy, children }: { variant: "sg90" | "mg996r"; angle: number; cx: number; cy: number; children: ReactNode }) {
  return <g transform={`rotate(${angle - 90} ${cx} ${cy})`} className={`hardware-artwork__servo-horn hardware-artwork__servo-horn--${variant}`}>{children}</g>;
}

function ActuatorArt({ kind, state, servoAngle = 90 }: {
  kind: Kind;
  state?: SimulatedComponentState;
  servoAngle?: number;
}) {
  const energized = artworkActuatorEnergized(state);
  const flowing = artworkFlowing(state);
  switch (kind) {
    case "sg90-servo": return <g>
      <rect x="48" y="28" width="124" height="87" rx="9" fill="#2472b8" stroke="#83c5ec" strokeWidth="3" />
      <rect x="58" y="39" width="104" height="60" rx="7" fill="#2d86d3" stroke="#145791" strokeWidth="2" />
      <circle cx="110" cy="69" r="23" fill="#1d2930" stroke="#a4b1b6" strokeWidth="3" />
      <circle cx="110" cy="69" r="12" fill="#35454d" stroke="#c4ced0" strokeWidth="2" />
      <ServoHorn variant="sg90" angle={servoAngle} cx={110} cy={69}>
        <rect x="100" y="8" width="20" height="43" rx="5" fill="#f2f0e2" stroke="#adb8b5" strokeWidth="3" />
        <circle cx="110" cy="15" r="4" fill="#d0b968" />
      </ServoHorn>
      <path d="M60 115v10m22-10v10m56-10v10m22-10v10" stroke={metal} strokeWidth="4" />
      <path d="M172 54h19m-19 12h19m-19 12h19" stroke="#e0a64b" strokeWidth="3" />
      <g fill={gold} stroke="#5c5034" strokeWidth="1"><circle cx="191" cy="54" r="2.8" /><circle cx="191" cy="66" r="2.8" /><circle cx="191" cy="78" r="2.8" /></g>
      <text x="110" y="108" textAnchor="middle" fill="#d9effe" fontSize="8" fontFamily="monospace">SG90 · 9 g</text>
    </g>;
    case "mg996r-servo": return <g>
      <path d="M53 36q0-8 8-8h98q8 0 8 8v73q0 8-8 8H61q-8 0-8-8z" fill="#3c4549" stroke="#a7b1b1" strokeWidth="4" />
      <rect x="64" y="42" width="92" height="52" rx="4" fill="#6b7475" stroke="#c3cccc" strokeWidth="3" />
      <path d="M68 49h84m-84 9h84m-84 9h84m-84 9h84" stroke="#aeb8b8" strokeWidth="2" />
      <ServoHorn variant="mg996r" angle={servoAngle} cx={110} cy={49}>
        <rect x="98" y="12" width="24" height="37" rx="5" fill="#e6e7df" stroke="#acb8b7" strokeWidth="3" />
        <circle cx="110" cy="18" r="4" fill="#d0b968" />
      </ServoHorn>
      <path d="M167 54h24m-24 12h24m-24 12h24" stroke="#e0a64b" strokeWidth="3" />
      <g fill={gold} stroke="#5c5034" strokeWidth="1"><circle cx="191" cy="54" r="2.8" /><circle cx="191" cy="66" r="2.8" /><circle cx="191" cy="78" r="2.8" /></g>
      <path d="M60 117v14m30-14v14m40-14v14m30-14v14" stroke={metal} strokeWidth="4" />
      <text x="110" y="105" textAnchor="middle" fill="#edf3ed" fontSize="8" fontFamily="monospace">MG996R · METAL GEAR</text>
    </g>;
    case "r385-pump": return <g>
      <rect x="47" y="36" width="97" height="70" rx="27" fill="#d9e0dd" stroke="#ffffff" strokeWidth="3" />
      <path d="M141 52h36q13 0 13 13v10h-48" fill="#e7ece8" stroke="#b4c0be" strokeWidth="3" />
      <rect x="25" y="55" width="31" height="32" rx="6" fill="#353e41" stroke="#778486" strokeWidth="3" />
      <ellipse cx="47" cy="71" rx="9" ry="25" fill="#50595b" />
      <path d="M181 55v-16h15v16m-15 36v16h15V91" fill="#d5ded9" stroke="#899694" strokeWidth="3" />
      <circle cx="78" cy="71" r="19" fill={energized ? "#c6dad2" : "#b7c1bf"} stroke={energized ? "#55ddbd" : "#8d999b"} strokeWidth={energized ? 3 : 2} />
      <g className={`hardware-artwork__rotor${energized ? " is-energized" : ""}`} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
        {[0, 120, 240].map(angle => <path key={angle} d="M78 71q-8-14 0-17 8 3 0 17" transform={`rotate(${angle} 78 71)`} fill={energized ? "#27a892" : "#667477"} stroke="#e2ece8" strokeWidth="1" />)}
        <circle cx="78" cy="71" r="4" fill="#29383c" />
      </g>
      {energized && <path d="M155 53q12 9 0 18m7-23q17 14 0 28" fill="none" stroke="#58d8c0" strokeWidth="2" opacity=".8" />}
      <path d="M24 63h12m-12 16h12" stroke="#e0a64b" strokeWidth="3" />
      <g fill={gold} stroke="#5c5034" strokeWidth="1"><circle cx="24" cy="63" r="2.8" /><circle cx="24" cy="79" r="2.8" /></g>
      <text x="111" y="76" textAnchor="middle" fill="#536064" fontSize="8" fontFamily="monospace">R385 PUMP</text>
    </g>;
    case "solenoid-valve": return <g>
      <path d="M25 65h37m96 0h37" stroke="#aeb9bc" strokeWidth="19" strokeLinecap="round" />
      <path d="M31 65h24m118 0h24" stroke="#e6ebea" strokeWidth="6" />
      <rect x="60" y="49" width="101" height="43" rx="8" fill="#b5bfbe" stroke="#edf0eb" strokeWidth="3" />
      <rect x="76" y="17" width="71" height="43" rx="6" fill={energized ? "#39434a" : "#263641"} stroke={energized ? "#e3b65e" : "#91a0a3"} strokeWidth={energized ? 4 : 3} opacity={energized ? 1 : .92} />
      <path d="M88 25v27m10-27v27m10-27v27m10-27v27m10-27v27" stroke={energized ? "#f1cd7d" : "#c89d55"} strokeWidth="3" />
      <g transform={energized ? "translate(0 -8)" : undefined}>
        <path d="M105 56v25h10V56" fill="#9ca8aa" stroke="#e1e7e4" strokeWidth="2" />
        <path d="M100 81h20" stroke="#778589" strokeWidth="3" />
      </g>
      <path d="M93 20V11m36 9v-9" stroke={metal} strokeWidth="3" />
      <g fill={gold} stroke="#5c5034" strokeWidth="1"><circle cx="93" cy="20" r="2.8" /><circle cx="129" cy="20" r="2.8" /></g>
      <text x="111" y="84" textAnchor="middle" fill="#354349" fontSize="7" fontFamily="monospace">12 V SOLENOID</text>
    </g>;
    case "yf-s201-inline-flow": return <g>
      <path d="M23 66h24m146 0h24" stroke="#e9edeb" strokeWidth="19" strokeLinecap="round" />
      <rect x="44" y="39" width="132" height="55" rx="21" fill="#e4e9e5" stroke="#ffffff" strokeWidth="3" />
      <circle cx="110" cy="66" r="24" fill={flowing ? "#c9e1d9" : "#b9c4c1"} stroke={flowing ? "#48d4b4" : "#7c8c8e"} strokeWidth="3" />
      <g className={`hardware-artwork__rotor${flowing ? " is-energized" : ""}`} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
        <circle cx="110" cy="66" r="7" fill="#363f42" />
        {Array.from({ length: 6 }, (_, i) => <path key={i} d={`M110 66l${stableSvgNumber(Math.cos(i * Math.PI / 3) * 20)} ${stableSvgNumber(Math.sin(i * Math.PI / 3) * 20)}`} stroke={flowing ? "#278d7a" : "#657276"} strokeWidth="3" />)}
      </g>
      {flowing && <text x="110" y="107" textAnchor="middle" fill="#45d8b4" fontSize="7" fontFamily="monospace">{Number(state?.readings?.flowLpm ?? 0).toFixed(1)} L/min</text>}
      <path d="M89 39V23h42v16" fill="#21292d" stroke="#657276" strokeWidth="3" />
      <path d="M90 23v-8m20 8v-8m20 8v-8" stroke={metal} strokeWidth="2.5" />
      <g fill={gold} stroke="#5c5034" strokeWidth="1"><circle cx="90" cy="23" r="2.8" /><circle cx="110" cy="23" r="2.8" /><circle cx="130" cy="23" r="2.8" /></g>
      <text x="110" y="113" textAnchor="middle" fill="#5b6868" fontSize="8" fontFamily="monospace">YF-S201 · FLOW</text>
    </g>;
    default: return null;
  }
}

function DriverArt({ kind, state }: { kind: Kind; state?: SimulatedComponentState }) {
  if (kind === "l298n-driver-board") return <g>
    <rect x="20" y="16" width="180" height="122" rx="8" fill="#8c3439" stroke="#d78372" strokeWidth="3" />
    <rect x="76" y="30" width="71" height="52" rx="4" fill="#252c2e" stroke="#6d7470" strokeWidth="3" />
    <text x="111" y="58" textAnchor="middle" fill="#d9e0d8" fontSize="9" fontFamily="monospace">L298N</text>
    <path d="M87 28V16h49v12m-38 54v16m25-16v16" fill="none" stroke="#bfc6c2" strokeWidth="6" />
    <rect x="151" y="34" width="34" height="27" rx="3" fill="#d7d6c9" stroke="#92998e" strokeWidth="2" />
    <rect x="29" y="91" width="46" height="29" rx="4" fill="#1a292e" stroke="#b7ac76" strokeWidth="2" />
    <Header x={20} y={31.25} count={7} spacing={15.25} />
    <Header x={200} y={33.43} count={6} spacing={17.43} />
    <text x="105" y="128" textAnchor="middle" fill="#f1d8c4" fontSize="7" fontFamily="monospace">DUAL H-BRIDGE · VM · 5V</text>
  </g>;
  if (kind === "tmc2209-driver-board") return <g>
    <rect x="43" y="15" width="134" height="123" rx="7" fill="#673d72" stroke="#bd92c2" strokeWidth="3" />
    <rect x="78" y="48" width="65" height="55" rx="5" fill="#182129" stroke="#b4a9bf" strokeWidth="3" />
    <text x="110" y="78" textAnchor="middle" fill="#e6d9eb" fontSize="9" fontFamily="monospace">TMC2209</text>
    <Header x={57} y={24} count={7} />
    <Header x={163} y={24} count={7} />
    <path d="M63 108h95" stroke="#cba966" strokeWidth="3" />
    <text x="110" y="128" textAnchor="middle" fill="#e4cee9" fontSize="7" fontFamily="monospace">STEP · DIR · UART</text>
  </g>;
  if (kind === "uln2003-driver-board") return <g>
    <rect x="39" y="18" width="142" height="120" rx="6" fill="#235c91" stroke="#83b1d8" strokeWidth="3" />
    <rect x="87" y="51" width="47" height="41" rx="8" fill="#172128" stroke="#6d858a" strokeWidth="2" />
    <text x="110" y="75" textAnchor="middle" fill="#d6e3e5" fontSize="7" fontFamily="monospace">ULN2003</text>
    {Array.from({ length: 4 }, (_, index) => <g key={index}><circle cx="65" cy={49 + index * 15} r="5" fill={index === 0 ? "#e7d34d" : "#334149"} stroke="#c8c8a8" /><text x="49" y={52 + index * 15} fill="#dbe8ee" fontSize="6">{index + 1}</text></g>)}
    <rect x="143" y="49" width="23" height="49" rx="3" fill="#151f25" stroke="#718287" />
    <Header x={39} y={31.33} count={8} spacing={13.33} />
    <Header x={181} y={33} count={7} spacing={15} />
    <text x="110" y="135" textAnchor="middle" fill="#d9e7f0" fontSize="6" fontFamily="monospace">28BYJ-48 DRIVER</text>
  </g>;
  if (kind === "max7219-matrix-board") return <g>
    <rect x="36" y="15" width="148" height="124" rx="7" fill="#1d536d" stroke="#83b1c3" strokeWidth="3" />
    <rect x="69" y="36" width="82" height="74" rx="5" fill="#11181d" stroke="#9babad" strokeWidth="3" />
    {Array.from({ length: 64 }, (_, index) => {
      const row = Math.floor(index / 8);
      const column = index % 8;
      const on = state?.display?.[row]?.[column] === "#";
      return <circle key={index} cx={79 + column * 9} cy={46 + row * 8} r="2.7" fill={on ? "#ff424b" : "#381d23"} stroke={on ? "#ffadb0" : "#67363b"} strokeWidth=".7" />;
    })}
    {Array.from({ length: 5 }, (_, index) => <g key={index} fill="#bea35f"><circle cx={51 + index * 17} cy="27" r="2.2" /><circle cx={51 + index * 17} cy="126" r="2.2" /></g>)}
    <text x="110" y="119" textAnchor="middle" fill="#d8e8e5" fontSize="7" fontFamily="monospace">MAX7219 · 8×8</text>
  </g>;
  return null;
}

function MotorArt({ kind, state }: { kind: Kind; state?: SimulatedComponentState }) {
  const angle = artworkStepperAngle(state);
  if (kind === "stepper-28byj-48") return <g>
    <rect x="52" y="29" width="104" height="88" rx="12" fill="#d5d9d3" stroke="#f1f1e9" strokeWidth="3" />
    <rect x="70" y="39" width="68" height="53" rx="7" fill="#ebece5" stroke="#a7b1ad" strokeWidth="3" />
    <path d="M78 41h52m-52 9h52m-52 9h52m-52 9h52m-52 9h52" stroke="#b9c1ba" strokeWidth="2" />
    <g transform={`rotate(${angle} 110 34)`}>
      <rect x="94" y="12" width="32" height="22" rx="5" fill="#bdc5c0" stroke="#f1f1e9" strokeWidth="2" />
      <path d="M98 17h24" stroke="#56ddc2" strokeWidth="3" />
      <circle cx="110" cy="15" r="5" fill="#9aa5a2" />
    </g>
    <path d="M57 117v15m26-15v15m54-15v15m-102-22h-17v-27h18" stroke="#45545a" strokeWidth="4" fill="none" />
    <Header x={72} y={132} count={5} vertical={false} spacing={16} />
    <text x="110" y="108" textAnchor="middle" fill="#586567" fontSize="7" fontFamily="monospace">28BYJ-48</text>
  </g>;
  if (kind === "nema17-17hs4401s") return <g>
    <rect x="41" y="15" width="138" height="123" rx="6" fill="#7b8587" stroke="#d5dcda" strokeWidth="4" />
    <rect x="55" y="29" width="110" height="95" rx="4" fill="#aeb6b6" stroke="#727e81" strokeWidth="3" />
    <circle cx="110" cy="77" r="28" fill="#333c40" stroke="#d5dcda" strokeWidth="5" />
    <circle cx="110" cy="77" r="13" fill="#aeb9ba" stroke="#566267" strokeWidth="3" />
    <g transform={`rotate(${angle} 110 77)`}>
      <path d="M110 49V8h14v42" fill="#9ca7a8" stroke="#d5dcda" strokeWidth="3" />
      <path d="M112 12v22" stroke="#4fd7bb" strokeWidth="3" />
    </g>
    <circle cx="55" cy="29" r="5" fill="#272e32" /><circle cx="165" cy="29" r="5" fill="#272e32" /><circle cx="55" cy="124" r="5" fill="#272e32" /><circle cx="165" cy="124" r="5" fill="#272e32" />
    <Header x={80} y={140} count={4} vertical={false} spacing={18} />
    <text x="110" y="108" textAnchor="middle" fill="#3c484b" fontSize="7" fontFamily="monospace">17HS4401S · NEMA 17</text>
  </g>;
  return null;
}

function DisplayArt({ kind, state }: { kind: Kind; state?: SimulatedComponentState }) {
  const displayedLines = artworkDisplayLines(state);
  const textualLines = displayedLines.filter(line => line.trim());
  const displayLines = textualLines.length ? textualLines : artworkSpiActivityLines(state);
  const screenText = (x: number, y: number, width: number, rows: number, lineHeight: number, color: string, fontSize = 7) =>
    displayLines.slice(0, rows).map((line, index) => <text key={index} x={x} y={y + index * lineHeight} textAnchor="start" fill={color} fontSize={fontSize} fontFamily="monospace" textLength={Math.max(3, Math.min(width, line.length * fontSize * .62))} lengthAdjust="spacingAndGlyphs">{line}</text>);
  if (kind === "tm1637-display") return <g>
    <rect x="18" y="38" width="184" height="78" rx="8" fill="#283238" stroke="#7b898b" strokeWidth="3" />
    <rect x="31" y="48" width="158" height="55" rx="5" fill="#172028" stroke="#52656a" strokeWidth="2" />
    {displayedLines[0]?.trim() && <text x="110" y="84" textAnchor="middle" fill="#ff4f55" fontSize="27" fontWeight="700" fontFamily="monospace" textLength={Math.min(140, Math.max(35, displayedLines[0].length * 19))} lengthAdjust="spacingAndGlyphs">{displayedLines[0].slice(0, 8)}</text>}
    <circle cx="183" cy="60" r="2" fill="#ed565d" />
    <text x="110" y="112" textAnchor="middle" fill="#c3d1d4" fontSize="7" fontFamily="monospace">TM1637 · CLK / DIO</text>
    <Header x={80} y={124} count={4} vertical={false} />
  </g>;
  if (kind === "sh1107-oled") return <g>
    <rect x="44" y="23" width="132" height="104" rx="6" fill="#071014" stroke="#48565b" strokeWidth="4" />
    <path d="M52 31h116v88H52z" fill="#06252b" />
    {screenText(58, 46, 102, 8, 9, "#56d9ca", 7)}
    <Header x={95} y={137} count={4} vertical={false} />
  </g>;
  if (kind === "st7735s-tft" || kind === "ili9341-tft" || kind === "epaper-2-9") {
    const isLarge = kind === "ili9341-tft";
    const isPaper = kind === "epaper-2-9";
    return <g>
      <rect x={isLarge ? 36 : 48} y="12" width={isLarge ? 148 : 124} height="116" rx="7" fill={isPaper ? "#e4e3d7" : "#202b32"} stroke={isPaper ? "#b6b8ae" : "#809196"} strokeWidth="4" />
      <rect x={isLarge ? 49 : 60} y="24" width={isLarge ? 122 : 100} height="90" rx={isPaper ? 1 : 3} fill={isPaper ? "#f6f5ea" : "#07545b"} stroke={isPaper ? "#b9bbb0" : "#354a53"} strokeWidth="2" />
      {screenText(isLarge ? 57 : 66, 43, isLarge ? 106 : 88, 7, 10, isPaper ? "#202628" : "#b6f4e6", 7)}
      <text x="110" y="134" textAnchor="middle" fill={isPaper ? "#566064" : "#c7d9dc"} fontSize="7" fontFamily="monospace">{isPaper ? "2.9 IN · E-PAPER" : isLarge ? "ILI9341 · 240×320" : "ST7735S · 128×160"}</text>
      <Header x={isLarge ? 65 : 70} y={142} count={isLarge ? 9 : 8} vertical={false} />
    </g>;
  }
  if (kind === "gc9a01-round-tft") return <g>
    <circle cx="110" cy="74" r="59" fill="#202b32" stroke="#93a3a6" strokeWidth="4" />
    <circle cx="110" cy="74" r="48" fill="#082d45" stroke="#4d6878" strokeWidth="3" />
    {screenText(80, 59, 60, 4, 10, "#a7f1e3", 6)}
    <text x="110" y="132" textAnchor="middle" fill="#cedde0" fontSize="7" fontFamily="monospace">GC9A01 · ROUND TFT</text>
    <Header x={70} y={142} count={8} vertical={false} />
  </g>;
  if (kind === "max7219-matrix-board") return DriverArt({ kind, state });
  return null;
}

function LogicArt({ kind, state }: { kind: Kind; state?: SimulatedComponentState }) {
  if (kind === "npn-to92" || kind === "pnp-to92" || kind === "nmos-to92") {
    const label = kind === "npn-to92" ? "2N2222" : kind === "pnp-to92" ? "2N3906" : "2N7000";
    return <g>
      <path d="M78 92v42m32-42v42m32-42v42" stroke={metal} strokeWidth="5" />
      <path d="M70 40q0-12 12-12h56q12 0 12 12v43q0 18-18 18H88q-18 0-18-18z" fill="#22292c" stroke="#747e80" strokeWidth="3" />
      <path d="M78 48q31-13 64 0" stroke="#434d50" strokeWidth="3" />
      <text x="110" y="72" textAnchor="middle" fill="#e0e5de" fontSize="8" fontFamily="monospace">{label}</text>
      <text x="110" y="85" textAnchor="middle" fill="#aab7b7" fontSize="7">{kind === "npn-to92" ? "NPN" : kind === "pnp-to92" ? "PNP" : "N-MOSFET"}</text>
    </g>;
  }
  if (kind === "ne555-dip8") return <g>
    <rect x="57" y="25" width="106" height="98" rx="10" fill="#11171b" stroke="#727d80" strokeWidth="3" />
    <path d="M91 25a19 19 0 0 0 38 0" fill="#0b1013" stroke="#718083" strokeWidth="2" />
    <circle cx="74" cy="41" r="3" fill="#d7c37a" />
    {Array.from({ length: 4 }, (_, index) => <g key={index} fill="#b5c0bf"><rect x={65 + index * 27} y="10" width="13" height="17" rx="2" /><rect x={65 + index * 27} y="121" width="13" height="17" rx="2" /></g>)}
    <Header x={71.5} y={10} count={4} vertical={false} spacing={27} />
    <Header x={71.5} y={138} count={4} vertical={false} spacing={27} />
    <text x="110" y="70" textAnchor="middle" fill="#e5e9df" fontSize="10" fontFamily="monospace">NE555</text>
    <text x="110" y="87" textAnchor="middle" fill="#849397" fontSize="7" fontFamily="monospace">TIMER · DIP-8</text>
  </g>;
  if (kind === "dip-switch-8") return <g>
    <rect x="29" y="28" width="162" height="91" rx="7" fill="#262d31" stroke="#778385" strokeWidth="3" />
    <rect x="41" y="38" width="138" height="62" rx="5" fill="#11181c" stroke="#445259" strokeWidth="2" />
    {Array.from({ length: 8 }, (_, index) => <g key={index}>
      <rect x={47 + index * 16} y="45" width="12" height="48" rx="2" fill="#454f52" stroke="#aab4af" strokeWidth="1.5" />
      <rect x={49 + index * 16} y={Number(state?.readings?.[`switch${index + 1}`] ?? 0) ? 49 : 68} width="8" height="20" rx="2" fill={Number(state?.readings?.[`switch${index + 1}`] ?? 0) ? "#cf514b" : "#dbd8c9"} />
      <text x={53 + index * 16} y="112" textAnchor="middle" fill="#d6dfd9" fontSize="6">{index + 1}</text>
    </g>)}
    <Header x={41} y={28} count={8} vertical={false} spacing={18} />
    <Header x={41} y={119} count={8} vertical={false} spacing={18} />
  </g>;
  return null;
}

function InputArt({ kind, state }: { kind: Kind; state?: SimulatedComponentState }) {
  if (kind === "ky023-joystick") return <g>
    <rect x="29" y="32" width="162" height="101" rx="9" fill="#252b31" stroke="#66757b" strokeWidth="3" />
    <circle cx="110" cy="79" r="40" fill="#161d22" stroke="#919da0" strokeWidth="4" />
    <circle cx="110" cy="79" r="30" fill="#252f35" stroke="#58666a" strokeWidth="3" />
    <g transform={`translate(${artworkJoystickOffset(state?.readings?.x)} ${-artworkJoystickOffset(state?.readings?.y)})`}>
      <path d="M110 78V38q0-13 12-13h7v42" fill="#10171b" stroke="#707e80" strokeWidth="3" />
      <g transform={Number(state?.readings?.pressed ?? 0) ? "translate(0 3)" : undefined}>
        <ellipse cx="122" cy="35" rx="17" ry="14" fill="#11171b" stroke={Number(state?.readings?.pressed ?? 0) ? "#57dfc1" : "#929d9d"} strokeWidth="3" />
        <circle cx="122" cy="35" r="5" fill="#b4c1c0" />
      </g>
    </g>
    <Header x={70} y={137} count={5} vertical={false} />
  </g>;
  if (kind === "nec-ir-remote") return <g>
    {Number(state?.readings?.commandCode ?? 0) > 0 && <path d="M95 14q15-12 30 0m-24-4q9-7 18 0" fill="none" stroke="#ff6a68" strokeWidth="2" />}
    <path d="M76 15q0-7 8-7h52q8 0 8 7v125q0 8-8 8H84q-8 0-8-8z" fill="#292f34" stroke="#8a9596" strokeWidth="3" />
    <circle cx="110" cy="23" r="8" fill={Number(state?.readings?.commandCode ?? 0) > 0 ? "#ff5757" : "#3c4345"} stroke="#b57e60" strokeWidth="2" />
    <rect x="91" y="36" width="38" height="12" rx="5" fill="#10171b" />
    {Array.from({ length: 12 }, (_, index) => <g key={index}><circle cx={96 + (index % 3) * 14} cy={62 + Math.floor(index / 3) * 17} r="5" fill={index === 0 ? "#d0514e" : "#bac3c0"} stroke="#59666b" strokeWidth="1" /><text x={96 + (index % 3) * 14} y={64 + Math.floor(index / 3) * 17} textAnchor="middle" fill="#263238" fontSize="4">{index + 1}</text></g>)}
    <text x="110" y="139" textAnchor="middle" fill="#d8e1dd" fontSize="6" fontFamily="monospace">NEC · IR</text>
  </g>;
  return null;
}

function PassiveArt({ kind }: { kind: Kind }) {
  switch (kind) {
    case "ceramic-capacitor": return <g>
      <path d="M48 76h48m28 0h48" stroke={metal} strokeWidth="4" />
      <rect x="91" y="58" width="38" height="36" rx="9" fill="#cc9d51" stroke="#efce8c" strokeWidth="3" />
      <path d="M98 64h23" stroke="#f3dea8" strokeWidth="2" />
      <text x="110" y="81" textAnchor="middle" fill="#604321" fontSize="7" fontFamily="monospace">1 µF</text>
    </g>;
    case "electrolytic-capacitor": return <g>
      <path d="M100 103v33m20-33v33" stroke={metal} strokeWidth="4" />
      <path d="M81 41q0-16 29-16t29 16v58q0 12-29 12T81 99z" fill="#aeb8ba" stroke="#e8ece7" strokeWidth="3" />
      <ellipse cx="110" cy="41" rx="29" ry="11" fill="#d8dedd" stroke="#f4f5ef" strokeWidth="2" />
      <path d="M110 31v20m-5-10h10" stroke="#59676a" strokeWidth="3" />
      <path d="M136 49v44" stroke="#434e53" strokeWidth="5" />
      <text x="105" y="81" textAnchor="middle" fill="#324047" fontSize="7" fontFamily="monospace">100 µF</text>
    </g>;
    case "rectifier-diode": return <g>
      <path d="M29 75h58m47 0h58" stroke={metal} strokeWidth="4" />
      <rect x="84" y="60" width="53" height="30" rx="13" fill="#252b2d" stroke="#778285" strokeWidth="3" />
      <path d="M123 61v28" stroke="#e1e6df" strokeWidth="5" />
      <text x="110" y="79" textAnchor="middle" fill="#d7dedb" fontSize="7" fontFamily="monospace">1N4007</text>
    </g>;
    default: return null;
  }
}

function MiscArt({ kind, state, servoAngle = 90 }: { kind: Kind; state?: SimulatedComponentState; servoAngle?: number }) {
  switch (kind) {
    case "sgp40-breakout": case "bme680-breakout": case "scd41-breakout": case "bme280-breakout": case "mpu6050-breakout": case "veml7700-breakout": case "apds9960-breakout": case "vl53l0x-breakout": return SensorArt({ kind });
    case "pir-dome-module": return SensorArt({ kind });
    case "mq2-gas-module": return SensorArt({ kind });
    case "rcwl0516-board": return SensorArt({ kind });
    case "ld2410c-radar-board": return SensorArt({ kind });
    case "jsn-sr04t-probe": return SensorArt({ kind });
    case "as5600-encoder-board": return SensorArt({ kind });
    case "mg996r-servo": case "sg90-servo": case "r385-pump": case "solenoid-valve": case "yf-s201-inline-flow": return ActuatorArt({ kind, state, servoAngle });
    case "l298n-driver-board": case "tmc2209-driver-board": case "uln2003-driver-board": case "max7219-matrix-board": return DriverArt({ kind, state });
    case "stepper-28byj-48": case "nema17-17hs4401s": return MotorArt({ kind, state });
    case "sh1107-oled": case "tm1637-display": case "st7735s-tft": case "ili9341-tft": case "epaper-2-9": case "gc9a01-round-tft": return DisplayArt({ kind, state });
    case "npn-to92": case "pnp-to92": case "nmos-to92": case "ne555-dip8": case "dip-switch-8": return LogicArt({ kind, state });
    case "ky023-joystick": case "nec-ir-remote": return InputArt({ kind, state });
    case "ceramic-capacitor": case "electrolytic-capacitor": case "rectifier-diode": return PassiveArt({ kind });
    case "ntc-bead": case "gl5528-photoresistor": case "tsop4838-receiver": case "vs1838b-receiver-module": return <SensorPackage kind={kind} />;
    case "pixel-ring": case "pixel-strip-30": case "pixel-strip-60": case "pixel-matrix-8x8": return PixelArt({ kind });
    case "breadboard-half": return <BreadboardArt full={false} />;
    case "breadboard-full": return <BreadboardArt full />;
    case "pp3-battery": return <g>
      <path d="M83 24v-9h18v9m18 0v-9h18v9" fill="#b8c2c1" stroke="#e2e6df" strokeWidth="2" />
      <rect x="59" y="24" width="102" height="113" rx="12" fill="#27303a" stroke="#7e8b8c" strokeWidth="4" />
      <path d="M68 39h84v76H68z" fill="#454c57" stroke="#9b9a81" strokeWidth="2" />
      {state?.powered && <g fill="#75f0c9"><circle cx="92" cy="19" r="3" /><circle cx="127" cy="19" r="3" /></g>}
      <text x="110" y="66" textAnchor="middle" fill="#f0d36b" fontSize="13" fontWeight="700" fontFamily="monospace">9 VOLT</text>
      <text x="110" y="85" textAnchor="middle" fill="#e8ece6" fontSize="8" fontFamily="monospace">ALKALINE · PP3</text>
      {state?.powered && <text x="110" y="103" textAnchor="middle" fill="#9af4d8" fontSize="7" fontFamily="monospace">{Number(state.readings?.voltage ?? 9).toFixed(1)} V ACTIVE</text>}
      <path d="M78 101h64" stroke="#d8c169" strokeWidth="2" />
    </g>;
    default: return null;
  }
}

export function HardwarePartArtwork({ type, state, preview = false, servoAngle = 90, simulationStatus = "idle" }: ArtworkProps) {
  const kind = getHardwareArtworkKind(type);
  if (!kind) return null;
  const artwork = kind === "breadboard-half" ? <BreadboardArt full={false} />
    : kind === "breadboard-full" ? <BreadboardArt full />
      : kind === "pixel-ring" || kind === "pixel-strip-30" || kind === "pixel-strip-60" || kind === "pixel-matrix-8x8" ? <PixelArt kind={kind} state={state} />
        : kind === "ceramic-capacitor" || kind === "electrolytic-capacitor" || kind === "rectifier-diode" ? <PassiveArt kind={kind} />
          : kind === "ntc-bead" || kind === "gl5528-photoresistor" || kind === "tsop4838-receiver" || kind === "vs1838b-receiver-module" ? <SensorPackage kind={kind} />
            : <MiscArt kind={kind} state={state} servoAngle={servoAngle} />;
  const viewBox = kind === "breadboard-full" ? "0 0 220 430" : kind === "breadboard-half" ? "0 0 220 260" : "0 0 220 150";
  return <svg className={`hardware-part-artwork${preview ? " hardware-part-artwork--preview" : ""}${simulationStatus === "running" ? " hardware-part-artwork--running" : ""}`} data-artwork-kind={kind} viewBox={viewBox} preserveAspectRatio="xMidYMid meet" aria-hidden="true">{artwork}</svg>;
}

export function HardwareBoardArtwork({ type, powered = false, preview = false }: ArtworkProps & { powered?: boolean }) {
  const kind = getHardwareBoardArtworkKind(type);
  if (!kind) return null;
  const boardHeight = kind === "xiao-esp32s3-sense" ? 240
    : kind === "esp32-devkit-v1-30pin" ? 367
      : kind === "esp32-nodemcu-32s" ? 443
        : 462;
  return <svg className={`hardware-board-artwork${powered ? " is-powered" : ""}${preview ? " hardware-part-artwork--preview" : ""}`} data-board-artwork-kind={kind} viewBox={`0 0 220 ${boardHeight}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true"><BoardArt kind={kind} /></svg>;
}

export function HardwareArtworkPreview({ type }: { type: string }) {
  return getHardwareBoardArtworkKind(type)
    ? <HardwareBoardArtwork type={type} preview />
    : <HardwarePartArtwork type={type} preview />;
}
