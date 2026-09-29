import type { CSSProperties } from "react";
import type { SimulatedComponentState, SimulatorStatus } from "../lib/simulator/types.ts";
import { motorDisplay } from "../lib/schematic/motor-display.ts";

import type { ComponentProperties } from "../lib/circuit/types.ts";
import { getComponentDefinition, simulationCapability } from "../lib/circuit/catalog.ts";
import { pinPosition } from "../lib/schematic/geometry.ts";
import { getBoardProfile, isBoardType } from "../lib/circuit/boards.ts";

export interface SchematicSymbolProps {
  type: string;
  properties?: Readonly<ComponentProperties>;
  powered?: boolean;
  simulationStatus?: SimulatorStatus;
  playbackSpeed?: number;
  zoom?: number;
}

type SymbolStyle = CSSProperties & Record<`--${string}`, string | number>;
type LogicGateType =
  | "logic-and"
  | "logic-or"
  | "logic-xor"
  | "logic-nand"
  | "logic-nor"
  | "logic-not";

const DIP_LEGS = Array.from({ length: 8 }, (_, index) => index + 1);
const SEVEN_SEGMENTS = ["a", "b", "c", "d", "e", "f", "g", "dp"] as const;

function symbolClass(type: string, powered: boolean) {
  return [
    "schematic-symbol",
    `schematic-symbol--${type}`,
    powered ? "schematic-symbol--powered" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function safeColor(value: ComponentProperties[string] | undefined, fallback: string) {
  if (
    typeof value === "string" &&
    (/^#[0-9a-f]{3,8}$/i.test(value) || /^hsl\([\d\s.,%]+\)$/i.test(value))
  ) {
    return value;
  }
  return fallback;
}

function numericProperty(
  properties: Readonly<ComponentProperties>,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const value = properties[key];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
}

function ArduinoUnoSymbol({ powered }: { powered: boolean }) {
  return (
    <div className={symbolClass("arduino-uno", powered)} aria-hidden="true">
      <div className="symbol-uno__board">
        <div className="symbol-uno__usb-port">
          <span className="symbol-uno__usb-mouth" />
        </div>
        <div className="symbol-uno__barrel-jack">
          <span className="symbol-uno__barrel-opening" />
        </div>
        <span className="symbol-uno__reset-button" />
        <span className="symbol-uno__reset-label">RESET</span>
        <div className="symbol-uno__atmega">
          <span className="symbol-uno__chip-notch" />
          <span className="symbol-uno__chip-label">ATMEGA328P</span>
        </div>
        <span className="symbol-uno__crystal">16.000</span>
        <span className="symbol-uno__voltage-regulator" />
        <span className="symbol-uno__icsp-header" />
        <span className="symbol-uno__status-led symbol-uno__status-led--on">ON</span>
        <span className="symbol-uno__status-led symbol-uno__status-led--tx">TX</span>
        <span className="symbol-uno__status-led symbol-uno__status-led--rx">RX</span>
        <span className="symbol-uno__status-led symbol-uno__status-led--l">L</span>
        <span className="symbol-uno__silkscreen symbol-uno__silkscreen--brand">ARDUINO</span>
        <span className="symbol-uno__silkscreen symbol-uno__silkscreen--model">UNO</span>
        <span className="symbol-uno__silkscreen symbol-uno__silkscreen--digital">DIGITAL PWM~</span>
        <span className="symbol-uno__silkscreen symbol-uno__silkscreen--power">POWER</span>
        <span className="symbol-uno__silkscreen symbol-uno__silkscreen--analog">ANALOG IN</span>
      </div>
    </div>
  );
}

function BoardSymbol({ type, powered }: { type: string; powered: boolean }) {
  const profile = getBoardProfile(type);
  if (!profile) return null;
  const variant = type.replace(/[^a-z0-9]+/gi, "-");
  return (
    <div className={`schematic-symbol schematic-symbol--board schematic-symbol--board-${variant} ${powered ? "schematic-symbol--powered" : ""}`} aria-hidden="true">
      <div className="symbol-board__pcb">
        <span className="symbol-board__header symbol-board__header--left" />
        <span className="symbol-board__header symbol-board__header--right" />
        <span className="symbol-board__usb"><i /></span>
        {type === "arduino-mega-2560" ? <>
          <span className="symbol-board__barrel"><i /></span>
          <span className="symbol-board__chip symbol-board__chip--mega"><b>ATMEGA2560</b></span>
          <span className="symbol-board__chip symbol-board__chip--usb"><b>16U2</b></span>
          <span className="symbol-board__icsp"><i /><i /><i /><i /><i /><i /></span>
          <span className="symbol-board__reset">RESET</span>
          <span className="symbol-board__brand">MEGA 2560</span>
        </> : type === "arduino-nano-classic" ? <>
          <span className="symbol-board__chip symbol-board__chip--main"><b>ATMEGA328P</b></span>
          <span className="symbol-board__chip symbol-board__chip--usb"><b>FT232</b></span>
          <span className="symbol-board__crystal">16 MHz</span>
          <span className="symbol-board__reset">RST</span>
          <span className="symbol-board__brand">NANO</span>
        </> : type === "esp32-devkitc-v4" ? <>
          <span className="symbol-board__chip symbol-board__radio-can"><b>ESP-WROOM-32E</b><i /></span>
          <span className="symbol-board__chip symbol-board__bridge"><b>CP2102</b></span>
          <span className="symbol-board__reset">EN</span>
          <span className="symbol-board__reset symbol-board__reset--boot">BOOT</span>
          <span className="symbol-board__regulator">3V3</span>
          <span className="symbol-board__brand">ESP32 DEVKITC</span>
        </> : type === "esp8266-nodemcu-v1" ? <>
          <span className="symbol-board__chip symbol-board__radio-can symbol-board__radio-can--8266"><b>ESP-12E</b><i /></span>
          <span className="symbol-board__antenna"><i /><i /><i /></span>
          <span className="symbol-board__chip symbol-board__bridge"><b>CH340</b></span>
          <span className="symbol-board__reset">RST</span>
          <span className="symbol-board__reset symbol-board__reset--boot">FLASH</span>
          <span className="symbol-board__brand">NodeMCU</span>
        </> : <>
          <span className="symbol-board__chip symbol-board__pico-mcu"><b>RP2040</b></span>
          <span className="symbol-board__chip symbol-board__pico-flash"><b>FLASH</b></span>
          <span className="symbol-board__reset symbol-board__reset--bootsel">BOOTSEL</span>
          <span className="symbol-board__brand">RASPBERRY PI PICO</span>
        </>}
        <span className="symbol-board__power-led" />
        <span className="symbol-board__trace symbol-board__trace--one" />
        <span className="symbol-board__trace symbol-board__trace--two" />
        <span className="symbol-board__silk">{profile.logicVoltage}V · {profile.mcu}</span>
      </div>
    </div>
  );
}

function LedSymbol({
  color,
  powered,
  rgb = false,
}: {
  color: string;
  powered: boolean;
  rgb?: boolean;
}) {
  const type = rgb ? "rgb-led" : "led";
  const style = { "--symbol-led-color": color } as SymbolStyle;
  return (
    <div className={symbolClass(type, powered)} style={style} aria-hidden="true">
      <div className="symbol-led__dome">
        <span className="symbol-led__highlight" />
        {rgb && (
          <span className="symbol-led__emitters">
            <i className="symbol-led__emitter symbol-led__emitter--red" />
            <i className="symbol-led__emitter symbol-led__emitter--green" />
            <i className="symbol-led__emitter symbol-led__emitter--blue" />
          </span>
        )}
      </div>
      <span className="symbol-led__rim" />
      <span className="symbol-led__lead symbol-led__lead--anode" />
      <span className="symbol-led__lead symbol-led__lead--cathode" />
      {rgb && <span className="symbol-led__lead symbol-led__lead--rgb-extra" />}
      {rgb && <span className="symbol-led__lead symbol-led__lead--common" />}
    </div>
  );
}

function ResistorSymbol({ powered }: { powered: boolean }) {
  return (
    <div className={symbolClass("resistor", powered)} aria-hidden="true">
      <span className="symbol-resistor__lead symbol-resistor__lead--left" />
      <span className="symbol-resistor__body">
        <i className="symbol-resistor__band symbol-resistor__band--one" />
        <i className="symbol-resistor__band symbol-resistor__band--two" />
        <i className="symbol-resistor__band symbol-resistor__band--multiplier" />
        <i className="symbol-resistor__band symbol-resistor__band--tolerance" />
      </span>
      <span className="symbol-resistor__lead symbol-resistor__lead--right" />
    </div>
  );
}

function PushButtonSymbol({ powered, normallyClosed }: { powered: boolean; normallyClosed: boolean }) {
  return (
    <div
      className={symbolClass("push-button", powered)}
      data-contact={normallyClosed ? "normally-closed" : "normally-open"}
      aria-hidden="true"
    >
      <span className="symbol-button__leg symbol-button__leg--left" />
      <span className="symbol-button__leg symbol-button__leg--right" />
      <span className="symbol-button__base">
        <i className="symbol-button__collar" />
        <i className="symbol-button__plunger" />
      </span>
    </div>
  );
}

function ToggleSwitchSymbol({ powered, position }: { powered: boolean; position: boolean }) {
  return (
    <div className={symbolClass("toggle-switch", powered)} data-position={position ? "no" : "nc"} aria-hidden="true">
      <span className="symbol-toggle__terminal symbol-toggle__terminal--left" />
      <span className="symbol-toggle__terminal symbol-toggle__terminal--center" />
      <span className="symbol-toggle__terminal symbol-toggle__terminal--right" />
      <span className="symbol-toggle__body">
        <i className="symbol-toggle__bezel" />
        <i className="symbol-toggle__lever" />
      </span>
    </div>
  );
}

function PotentiometerSymbol({ powered, value }: { powered: boolean; value: number }) {
  const style = { "--symbol-pot-value": `${value}%` } as SymbolStyle;
  return (
    <div className={symbolClass("potentiometer", powered)} style={style} aria-hidden="true">
      <span className="symbol-pot__terminal symbol-pot__terminal--left" />
      <span className="symbol-pot__terminal symbol-pot__terminal--wiper" />
      <span className="symbol-pot__terminal symbol-pot__terminal--right" />
      <span className="symbol-pot__case">
        <i className="symbol-pot__dial">
          <b className="symbol-pot__wiper" />
        </i>
        <i className="symbol-pot__index" />
      </span>
    </div>
  );
}

function SevenSegmentSymbol({ color, powered, segments }: { color: string; powered: boolean; segments: ReadonlyArray<string> }) {
  const style = { "--symbol-display-color": color } as SymbolStyle;
  return (
    <div className={symbolClass("seven-segment", powered)} style={style} aria-hidden="true">
      <span className="symbol-seven-segment__case">
        <i className="symbol-seven-segment__digit">
          {SEVEN_SEGMENTS.map((segment) => (
            <b key={segment} className={`symbol-seven-segment__segment symbol-seven-segment__segment--${segment} ${segments.includes(segment.toUpperCase()) ? "active" : ""}`} />
          ))}
        </i>
      </span>
    </div>
  );
}

function LcdSymbol({ powered, text }: { powered: boolean; text: string }) {
  const explicitLines = text.split(/\r?\n/);
  const normalizedText = text.replace(/\s+/g, " ").trim();
  const firstLine = (explicitLines.length > 1 ? explicitLines[0] : normalizedText || "CIRKITRA").slice(0, 16);
  const secondLine = (explicitLines.length > 1 ? explicitLines[1] : normalizedText.slice(16, 32) || (powered ? "READY_" : "")).slice(0, 16);
  return (
    <div className={symbolClass("lcd-16x2", powered)} aria-hidden="true">
      <span className="symbol-lcd__pcb">
        <i className="symbol-lcd__mount symbol-lcd__mount--top-left" />
        <i className="symbol-lcd__mount symbol-lcd__mount--top-right" />
        <i className="symbol-lcd__mount symbol-lcd__mount--bottom-left" />
        <i className="symbol-lcd__mount symbol-lcd__mount--bottom-right" />
        <span className="symbol-lcd__bezel">
          <i className="symbol-lcd__screen">
            <b>{firstLine}</b>
            <b>{secondLine}</b>
          </i>
        </span>
      </span>
    </div>
  );
}

function BuzzerSymbol({ powered }: { powered: boolean }) {
  return (
    <div className={symbolClass("buzzer", powered)} aria-hidden="true">
      <span className="symbol-buzzer__lead symbol-buzzer__lead--positive" />
      <span className="symbol-buzzer__lead symbol-buzzer__lead--negative" />
      <span className="symbol-buzzer__case">
        <i className="symbol-buzzer__aperture" />
        <i className="symbol-buzzer__polarity">+</i>
      </span>
      <span className="symbol-buzzer__wave symbol-buzzer__wave--near" />
      <span className="symbol-buzzer__wave symbol-buzzer__wave--far" />
    </div>
  );
}

function ServoSymbol({ powered, angle }: { powered: boolean; angle: number }) {
  const style = { "--symbol-servo-angle": `${angle - 90}deg` } as SymbolStyle;
  return (
    <div className={symbolClass("servo", powered)} style={style} aria-hidden="true">
      <span className="symbol-servo__cable">
        <i className="symbol-servo__wire symbol-servo__wire--signal" />
        <i className="symbol-servo__wire symbol-servo__wire--power" />
        <i className="symbol-servo__wire symbol-servo__wire--ground" />
      </span>
      <span className="symbol-servo__case">
        <i className="symbol-servo__mount symbol-servo__mount--left" />
        <i className="symbol-servo__mount symbol-servo__mount--right" />
        <i className="symbol-servo__hub" />
        <i className="symbol-servo__horn" />
        <b className="symbol-servo__label">SERVO</b>
      </span>
    </div>
  );
}

function DcMotorSymbol({ powered, direction, speed, simulationStatus = "idle", playbackSpeed = 1, zoom = 1 }: {
  powered: boolean; direction?: string; speed?: number;
  simulationStatus?: SimulatorStatus; playbackSpeed?: number; zoom?: number;
}) {
  const display = motorDisplay({ powered, direction, speed, status: simulationStatus, playbackSpeed });
  return (
    <div className={symbolClass("dc-motor", display.active)} data-direction={display.direction} data-motion={display.moving ? "running" : "paused"}
      style={{ "--symbol-motor-speed": `${display.duration}s`, "--motor-badge-scale": Math.min(2, 1 / Math.max(0.1, zoom)) } as SymbolStyle}>
      <div aria-hidden="true">
        <span className="symbol-motor__terminal symbol-motor__terminal--positive" />
        <span className="symbol-motor__terminal symbol-motor__terminal--negative" />
        <span className="symbol-motor__can">
          <i className="symbol-motor__vent symbol-motor__vent--one" />
          <i className="symbol-motor__vent symbol-motor__vent--two" />
          <b className="symbol-motor__polarity">+</b>
        </span>
        <span className="symbol-motor__endbell" />
        <span className="symbol-motor__shaft" />
        <span className="symbol-motor__rotor"><i /><b /></span>
      </div>
      <span className="symbol-motor__status" title="Simulated drive level, not physical RPM">
        <span aria-hidden="true">{display.active ? display.direction === "reverse" ? "↶" : "↷" : "■"}</span> {display.label}
      </span>
    </div>
  );
}

function L293dSymbol({ powered }: { powered: boolean }) {
  return (
    <div className={symbolClass("l293d", powered)} aria-hidden="true">
      <span className="symbol-dip__legs symbol-dip__legs--left">
        {DIP_LEGS.map((leg) => <i key={leg} className="symbol-dip__leg" />)}
      </span>
      <span className="symbol-dip__body">
        <i className="symbol-dip__notch" />
        <i className="symbol-dip__pin-one" />
        <b className="symbol-dip__label">L293D</b>
        <small className="symbol-dip__sub-label">MOTOR DRIVER</small>
      </span>
      <span className="symbol-dip__legs symbol-dip__legs--right">
        {DIP_LEGS.map((leg) => <i key={leg} className="symbol-dip__leg" />)}
      </span>
    </div>
  );
}

function LogicGateSymbol({ type, powered, outputHigh }: { type: LogicGateType; powered: boolean; outputHigh: boolean }) {
  const inverted = type === "logic-nand" || type === "logic-nor" || type === "logic-not";
  const gateLabel: Record<LogicGateType, string> = {
    "logic-and": "&",
    "logic-or": "≥1",
    "logic-xor": "=1",
    "logic-nand": "&",
    "logic-nor": "≥1",
    "logic-not": "1",
  };
  return (
    <div className={symbolClass(type, powered)} data-output={outputHigh ? "high" : "low"} aria-hidden="true">
      {type !== "logic-not" && <span className="symbol-gate__input symbol-gate__input--a" />}
      <span className={`symbol-gate__input ${type === "logic-not" ? "symbol-gate__input--single" : "symbol-gate__input--b"}`} />
      <span className={`symbol-gate__body symbol-gate__body--${type.replace("logic-", "")}`}>
        <b className="symbol-gate__operator">{gateLabel[type]}</b>
      </span>
      {inverted && <span className="symbol-gate__inversion-bubble" />}
      <span className="symbol-gate__output" />
    </div>
  );
}

function UltrasonicSymbol({ powered }: { powered: boolean }) {
  return (
    <div className={symbolClass("hc-sr04", powered)} aria-hidden="true">
      <span className="symbol-ultrasonic__pcb">
        <i className="symbol-ultrasonic__mount symbol-ultrasonic__mount--left" />
        <i className="symbol-ultrasonic__mount symbol-ultrasonic__mount--right" />
        <span className="symbol-ultrasonic__transducer symbol-ultrasonic__transducer--trigger"><i /></span>
        <span className="symbol-ultrasonic__transducer symbol-ultrasonic__transducer--echo"><i /></span>
        <b className="symbol-ultrasonic__label">HC-SR04</b>
      </span>
    </div>
  );
}

function PirSymbol({ powered, motion }: { powered: boolean; motion: boolean }) {
  return (
    <div className={symbolClass("pir-sensor", powered || motion)} data-motion={motion ? "detected" : "clear"} aria-hidden="true">
      <span className="symbol-pir__pcb">
        <i className="symbol-pir__mount symbol-pir__mount--left" />
        <i className="symbol-pir__mount symbol-pir__mount--right" />
        <span className="symbol-pir__lens">
          <i className="symbol-pir__lens-ring symbol-pir__lens-ring--outer" />
          <i className="symbol-pir__lens-ring symbol-pir__lens-ring--middle" />
          <i className="symbol-pir__lens-ring symbol-pir__lens-ring--inner" />
        </span>
        <span className="symbol-pir__trimmer symbol-pir__trimmer--delay" />
        <span className="symbol-pir__trimmer symbol-pir__trimmer--sensitivity" />
      </span>
    </div>
  );
}

function TemperatureSymbol({ powered, temperature }: { powered: boolean; temperature: number }) {
  return (
    <div className={symbolClass("temperature-sensor", powered)} aria-hidden="true">
      <span style={{ position: "absolute", inset: 15, border: "2px solid #f97316", borderRadius: 12, background: "#29140c", display: "grid", placeItems: "center", color: "#fdba74", font: "700 13px var(--font-mono)" }}>{Math.round(temperature)}°</span>
    </div>
  );
}

function GenericSymbol({ type, powered, state, zoom = 1, status }: { type: string; powered: boolean; state?: SimulatedComponentState; zoom?: number; status?: SimulatorStatus }) {
  const definition = getComponentDefinition(type);
  if (definition?.symbol) return (
    <div className={`symbol-registry symbol-registry--${definition.symbol} symbol-registry--${type} ${powered && simulationCapability(definition) !== "unavailable" ? "is-powered" : ""}`} aria-hidden="true">
      <div className="symbol-registry__body"><b>{definition.displayName}</b><small>{definition.metadata?.manufacturer}</small></div>
      <RegisteredPartArtwork type={type} state={state} />
      {type === "ds3231-rtc" && <span className="symbol-rtc__display"><b>{["hour", "minute", "second"].map(key => String(Math.trunc(Number(state?.readings?.[key] ?? 0))).padStart(2, "0")).join(":")}</b><small>{["year", "month", "day"].map(key => String(Math.trunc(Number(state?.readings?.[key] ?? 0))).padStart(key === "year" ? 4 : 2, "0")).join("-")}</small></span>}
      {type === "ssd1306-oled-128x64" && <span className="symbol-oled__screen"><b>{(state?.display ?? ["CIRKITRA", "OLED 128×64"]).filter(Boolean).slice(0, 2).join("\n")}</b></span>}
      {type === "bh1750-sen0097" && <span className="symbol-light__sensor"><i /><b>{Number(state?.readings?.lux ?? 0).toFixed(0)} lx</b></span>}
      {type === "soil-moisture-sen0193" && <span className="symbol-soil__probe"><i /><i /><i /><i /><i /><b>{Number(state?.readings?.moisture ?? 50).toFixed(0)}%</b></span>}
      {type === "micro-sd-spi-module" && <span className="symbol-sd__card"><b>SD</b><small>{state?.readings?.files ?? 0} files · {state?.readings?.storedBytes ?? 0} B</small></span>}
      {type === "mfrc522-rfid-module" && <span className="symbol-rfid__antenna"><i /><i /><i /><b>{state?.status?.startsWith("Tag ") ? state.status.slice(4) : "RFID"}</b></span>}
      {type === "a4988-stepper-driver" && <span className="symbol-a4988__step"><i /><i /><small>{state?.readings?.steps ?? 0} steps · 1/{state?.readings?.microstep ?? 1}</small></span>}
      {type === "bipolar-stepper-motor" && <span className="symbol-stepper__rotor" style={{ transform: `translate(-50%, -50%) rotate(${Number(state?.readings?.angleDegrees ?? 0)}deg)` }}><i /><b>{state?.readings?.angleDegrees ?? 0}°</b></span>}
      {type === "ky-040" && <span className={`symbol-ky040__wheel ${state?.readings?.buttonPressed ? "is-pressed" : ""}`} style={{ transform: `translate(-50%, -50%) rotate(${Number(state?.readings?.position ?? 0) * 18}deg)` }}><i /><b>{state?.readings?.position ?? 0}</b></span>}
      {type === "keypad-4x4" && <span className="symbol-keypad__matrix">{"123A456B789C*0#D".split("").map((key, index) => <i key={index} className={Number(state?.readings?.keyCode) === key.charCodeAt(0) ? "is-active" : ""}>{key}</i>)}</span>}
      {type === "relay-module-1ch-active-low" && <span className={`symbol-relay__contact ${state?.readings?.energized ? "is-energized" : ""}`}><i /></span>}
      {type === "ws2812b-strip-8" && <div className="symbol-ws2812__pixels" aria-label="Simulated RGB pixels">{(state?.pixels ?? Array.from({ length: 8 }, () => ({ r: 0, g: 0, b: 0 }))).map((pixel, index) => <i key={index} style={{ background: `rgb(${pixel.r}, ${pixel.g}, ${pixel.b})`, boxShadow: pixel.r || pixel.g || pixel.b ? `0 0 8px rgb(${pixel.r}, ${pixel.g}, ${pixel.b})` : "none" }} />)}</div>}
      {definition.pins.map(pin => {
        const point = pinPosition({ type, x: 0, y: 0 }, pin.id, definition);
        return point && <span key={pin.id} className={`symbol-registry__pin side-${pin.side} ${pin.noConnect ? "is-nc" : ""}`} style={{ top: point.y }}><em>{pin.number}</em> {pin.label}</span>;
      })}
      {state?.status && simulationCapability(definition) !== "unavailable" && status !== "idle" && !state.fault && state.status !== "Wiring fault" && <span className="symbol-registry__state" style={{ transform: `translateX(-50%) scale(${1 / Math.max(0.4, Math.min(1, zoom))})` }}>
        <strong>{state.status}{status === "paused" ? " · Paused" : ""}</strong>
        {state.powered && <small>{Object.entries(state.readings ?? {}).filter(([, value]) => Number.isFinite(value)).slice(0, 2).map(([key, value]) => `${key}: ${Number(value.toFixed(2))}`).join(" · ")}</small>}
        {state.powered && state.display?.some(line => line.trim()) && <small>{state.display.filter(line => line.trim()).slice(0, 2).join(" · ")}</small>}
      </span>}
    </div>
  );
  const label = type.replace(/[-_]+/g, " ").trim().toUpperCase().slice(0, 14) || "PART";
  return (
    <div className={symbolClass("generic", powered)} data-component-type={type} aria-hidden="true">
      <span className="symbol-generic__lead symbol-generic__lead--left" />
      <span className="symbol-generic__body">
        <i className="symbol-generic__notch" />
        <b className="symbol-generic__label">{label}</b>
      </span>
      <span className="symbol-generic__lead symbol-generic__lead--right" />
    </div>
  );
}

function RegisteredPartArtwork({ type, state }: { type: string; state?: SimulatedComponentState }) {
  if (["dc-supply", "battery-cell", "dc-load", "ideal-mosfet"].includes(type)) {
    return <PowerPartArtwork type={type} state={state} />;
  }
  if (["rfm95w", "xbee-s2c-zigbee-th"].includes(type)) {
    return <span className={`symbol-part-art symbol-part-art--radio symbol-part-art--${type}`}>
      <i className="symbol-part-art__mount symbol-part-art__mount--one" /><i className="symbol-part-art__mount symbol-part-art__mount--two" />
      <span className="symbol-radio__module"><b>{type === "rfm95w" ? "RFM95W" : "XBEE S2C"}</b><small>{type === "rfm95w" ? "LoRa · 868/915 MHz" : "Zigbee · 2.4 GHz"}</small></span>
      <span className={`symbol-radio__antenna ${type === "rfm95w" ? "is-meander" : "is-ceramic"}`}><i /><i /><i /></span>
      <span className="symbol-part-art__silk">3V3 · SPI / UART</span>
    </span>;
  }
  if (["ssd1306-oled-128x64", "bh1750-sen0097", "soil-moisture-sen0193"].includes(type)) {
    return <span className={`symbol-part-art symbol-part-art--sensor symbol-part-art--${type}`}>
      <i className="symbol-part-art__mount symbol-part-art__mount--one" /><i className="symbol-part-art__mount symbol-part-art__mount--two" />
      {type === "ssd1306-oled-128x64" ? <><span className="symbol-oled__bezel"><i /><i /><i /></span><span className="symbol-part-art__silk">128 × 64 · I²C</span></> : null}
      {type === "bh1750-sen0097" ? <><span className="symbol-light__lens"><i /></span><span className="symbol-part-art__silk">BH1750 · DIGITAL LUX</span></> : null}
      {type === "soil-moisture-sen0193" ? <><span className="symbol-soil__neck" /><span className="symbol-soil__blade"><i /><i /><i /></span><span className="symbol-part-art__silk">CAPACITIVE · ANALOG</span></> : null}
    </span>;
  }
  if (["dht22", "ds18b20"].includes(type)) {
    return <span className={`symbol-part-art symbol-part-art--sensor-package symbol-part-art--${type}`}>
      {type === "dht22" ? <span className="symbol-sensor-package__grille"><i /><i /><i /><i /><b>AM2302</b></span> : <span className="symbol-sensor-package__to92"><i /><i /><i /><b>DS18B20</b></span>}
    </span>;
  }
  if (getComponentDefinition(type)?.symbol === "ic") {
    const packageType = ["l298"].includes(type) ? "power" : ["tb6612fng", "drv8833"].includes(type) ? "driver" : "logic";
    const coreLabel: Record<string, string> = {
      bme280: "BME280", bmp280: "BMP280", "sht31-dis": "SHT31", "mpu-6050": "MPU-6050",
      cd74hc4067: "4067", cd74hc4051: "4051", "74hc138": "74HC138", "74hc595": "74HC595",
      mcp23017: "MCP23017", tca9548a: "TCA9548A", tb6612fng: "TB6612FNG", drv8833: "DRV8833", l298: "L298",
      bq24074: "BQ24074", "bq27441-g1": "BQ27441", bq76920: "BQ76920",
    };
    return <span className={`symbol-part-art symbol-part-art--ic symbol-part-art--${type} symbol-part-art--${packageType}`}>
      <i className="symbol-chip__pins symbol-chip__pins--left" /><i className="symbol-chip__pins symbol-chip__pins--right" />
      <span className="symbol-chip__case"><i className="symbol-chip__notch" /><i className="symbol-chip__pin-one" /><b>{coreLabel[type] ?? type.toUpperCase()}</b><small>{type === "mcp23017" ? "16-BIT GPIO" : ["cd74hc4067", "cd74hc4051", "74hc138", "tca9548a"].includes(type) ? "LOGIC / MUX" : packageType === "driver" || packageType === "power" ? "POWER IC" : "SENSOR IC"}</small></span>
    </span>;
  }
  if (getComponentDefinition(type)?.symbol === "module") {
    const alreadyIllustrated = ["ds3231-rtc", "micro-sd-spi-module", "mfrc522-rfid-module", "a4988-stepper-driver", "bipolar-stepper-motor", "ky-040", "keypad-4x4", "relay-module-1ch-active-low", "ws2812b-strip-8"].includes(type);
    return <span className={`symbol-part-art symbol-part-art--module symbol-part-art--${type}`}>
      <i className="symbol-part-art__mount symbol-part-art__mount--one" /><i className="symbol-part-art__mount symbol-part-art__mount--two" />
      <i className="symbol-part-art__trace symbol-part-art__trace--one" /><i className="symbol-part-art__trace symbol-part-art__trace--two" />
      {!alreadyIllustrated && <><span className="symbol-module__core"><i /><b>MODULE</b></span><span className="symbol-part-art__silk">{getComponentDefinition(type)?.metadata?.interfaces.slice(0, 2).join(" · ") ?? "I/O MODULE"}</span></>}
    </span>;
  }
  return null;
}

function PowerPartArtwork({ type, state }: { type: string; state?: SimulatedComponentState }) {
  if (type === "battery-cell") {
    const charge = Math.min(100, Math.max(0, Number(state?.readings?.stateOfCharge ?? 78)));
    return <span className="symbol-power-art symbol-power-art--battery"><span className="symbol-battery__can"><i className="symbol-battery__cap" /><b>Li-ion</b><small>{charge.toFixed(0)}%</small><i className="symbol-battery__charge" style={{ width: `${charge}%` }} /></span></span>;
  }
  if (type === "dc-supply") return <span className="symbol-power-art symbol-power-art--supply"><span className="symbol-supply__face"><small>DC POWER</small><b>{Number(state?.readings?.voltage ?? 9).toFixed(1)} <i>V</i></b><em>{Number(state?.readings?.current ?? 0).toFixed(2)} A</em></span><i className="symbol-supply__jack symbol-supply__jack--red" /><i className="symbol-supply__jack symbol-supply__jack--black" /></span>;
  if (type === "dc-load") return <span className="symbol-power-art symbol-power-art--load"><span className="symbol-load__body"><i /><i /><i /><i /><b>LOAD</b></span><small>{Number(state?.readings?.power ?? 0).toFixed(1)} W</small></span>;
  return <span className={`symbol-power-art symbol-power-art--mosfet ${state?.readings?.enabled ? "is-on" : ""}`}><span className="symbol-mosfet__case"><b>N</b><small>MOSFET</small></span><i className="symbol-mosfet__lead symbol-mosfet__lead--gate" /><i className="symbol-mosfet__lead symbol-mosfet__lead--drain" /><i className="symbol-mosfet__lead symbol-mosfet__lead--source" /></span>;
}

function GroundSymbol() {
  return (
    <div className={symbolClass("ground", false)} aria-hidden="true">
      <i className="symbol-ground__lead" />
      <i className="symbol-ground__bar symbol-ground__bar--wide" />
      <i className="symbol-ground__bar symbol-ground__bar--middle" />
      <i className="symbol-ground__bar symbol-ground__bar--narrow" />
    </div>
  );
}

export function SchematicSymbol({
  type,
  properties = {},
  powered = false,
  simulationStatus,
  playbackSpeed,
  zoom,
}: SchematicSymbolProps) {
  let electrical: Partial<SimulatedComponentState> = {};
  try {
    electrical = JSON.parse(typeof properties.__electricalState === "string" ? properties.__electricalState : "null") ?? {};
  } catch {
    electrical = {};
  }
  if (isBoardType(type) && type !== "arduino-uno") return <BoardSymbol type={type} powered={powered} />;
  if (getComponentDefinition(type)?.symbol) return <GenericSymbol type={type} powered={powered} state={electrical as SimulatedComponentState} zoom={zoom} status={simulationStatus} />;
  switch (type) {
    case "ground":
      return <GroundSymbol />;
    case "arduino-uno":
      return <ArduinoUnoSymbol powered={powered} />;
    case "led":
      return <LedSymbol color={safeColor(properties.color, "#ef4444")} powered={powered} />;
    case "rgb-led":
      return <LedSymbol color={`rgb(${Math.round((electrical.channels?.R ?? 0) * 255)}, ${Math.round((electrical.channels?.G ?? 0) * 255)}, ${Math.round((electrical.channels?.B ?? 0) * 255)})`} powered={powered} rgb />;
    case "resistor":
      return <ResistorSymbol powered={powered} />;
    case "push-button":
      return <PushButtonSymbol powered={powered} normallyClosed={properties.normallyClosed === true} />;
    case "toggle-switch":
      return <ToggleSwitchSymbol powered={powered} position={electrical.position ?? properties.position === true} />;
    case "potentiometer":
      return <PotentiometerSymbol powered={powered} value={numericProperty(properties, "value", 50, 0, 100)} />;
    case "seven-segment":
      return <SevenSegmentSymbol color={safeColor(properties.color, "#ef4444")} powered={powered} segments={electrical.segments ?? []} />;
    case "lcd-16x2":
      return <LcdSymbol powered={powered} text={typeof properties.text === "string" ? properties.text : ""} />;
    case "buzzer":
      return <BuzzerSymbol powered={powered} />;
    case "servo":
      return <ServoSymbol powered={powered} angle={numericProperty(properties, "angle", 90, 0, 180)} />;
    case "dc-motor":
      return <DcMotorSymbol powered={powered} direction={electrical.direction} speed={electrical.speed} simulationStatus={simulationStatus} playbackSpeed={playbackSpeed} zoom={zoom} />;
    case "l293d":
      return <L293dSymbol powered={powered} />;
    case "logic-and":
    case "logic-or":
    case "logic-xor":
    case "logic-nand":
    case "logic-nor":
    case "logic-not":
      return <LogicGateSymbol type={type} powered={powered} outputHigh={electrical.level === "high"} />;
    case "hc-sr04":
      return <UltrasonicSymbol powered={powered} />;
    case "pir-sensor":
      return <PirSymbol powered={powered} motion={powered && properties.motion === true} />;
    case "temperature-sensor":
      return <TemperatureSymbol powered={powered} temperature={numericProperty(properties, "temperatureC", 24, -40, 125)} />;
    default:
      return <GenericSymbol type={type} powered={powered} />;
  }
}
