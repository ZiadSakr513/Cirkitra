import type { CSSProperties } from "react";

import type { ComponentProperties } from "../lib/circuit/types.ts";

export interface SchematicSymbolProps {
  type: string;
  properties?: Readonly<ComponentProperties>;
  powered?: boolean;
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

function ToggleSwitchSymbol({ powered }: { powered: boolean }) {
  return (
    <div className={symbolClass("toggle-switch", powered)} aria-hidden="true">
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

function SevenSegmentSymbol({ color, powered }: { color: string; powered: boolean }) {
  const style = { "--symbol-display-color": color } as SymbolStyle;
  return (
    <div className={symbolClass("seven-segment", powered)} style={style} aria-hidden="true">
      <span className="symbol-seven-segment__case">
        <i className="symbol-seven-segment__digit">
          {SEVEN_SEGMENTS.map((segment) => (
            <b key={segment} className={`symbol-seven-segment__segment symbol-seven-segment__segment--${segment}`} />
          ))}
        </i>
      </span>
    </div>
  );
}

function LcdSymbol({ powered, text }: { powered: boolean; text: string }) {
  const normalizedText = text.replace(/\s+/g, " ").trim();
  const firstLine = (normalizedText || "ZIRCUIT").slice(0, 16);
  const secondLine = normalizedText.slice(16, 32) || (powered ? "READY_" : "");
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

function DcMotorSymbol({ powered }: { powered: boolean }) {
  return (
    <div className={symbolClass("dc-motor", powered)} aria-hidden="true">
      <span className="symbol-motor__terminal symbol-motor__terminal--positive" />
      <span className="symbol-motor__terminal symbol-motor__terminal--negative" />
      <span className="symbol-motor__can">
        <i className="symbol-motor__vent symbol-motor__vent--one" />
        <i className="symbol-motor__vent symbol-motor__vent--two" />
        <b className="symbol-motor__polarity">+</b>
      </span>
      <span className="symbol-motor__endbell" />
      <span className="symbol-motor__shaft" />
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

function LogicGateSymbol({ type, powered }: { type: LogicGateType; powered: boolean }) {
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
    <div className={symbolClass(type, powered)} aria-hidden="true">
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

function GenericSymbol({ type, powered }: { type: string; powered: boolean }) {
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

export function SchematicSymbol({
  type,
  properties = {},
  powered = false,
}: SchematicSymbolProps) {
  switch (type) {
    case "arduino-uno":
      return <ArduinoUnoSymbol powered={powered} />;
    case "led":
      return <LedSymbol color={safeColor(properties.color, "#ef4444")} powered={powered} />;
    case "rgb-led":
      return <LedSymbol color={safeColor(properties.color, "#f8fafc")} powered={powered} rgb />;
    case "resistor":
      return <ResistorSymbol powered={powered} />;
    case "push-button":
      return <PushButtonSymbol powered={powered} normallyClosed={properties.normallyClosed === true} />;
    case "toggle-switch":
      return <ToggleSwitchSymbol powered={powered} />;
    case "potentiometer":
      return <PotentiometerSymbol powered={powered} value={numericProperty(properties, "value", 50, 0, 100)} />;
    case "seven-segment":
      return <SevenSegmentSymbol color={safeColor(properties.color, "#ef4444")} powered={powered} />;
    case "lcd-16x2":
      return <LcdSymbol powered={powered} text={typeof properties.text === "string" ? properties.text : ""} />;
    case "buzzer":
      return <BuzzerSymbol powered={powered} />;
    case "servo":
      return <ServoSymbol powered={powered} angle={numericProperty(properties, "angle", 90, 0, 180)} />;
    case "dc-motor":
      return <DcMotorSymbol powered={powered} />;
    case "l293d":
      return <L293dSymbol powered={powered} />;
    case "logic-and":
    case "logic-or":
    case "logic-xor":
    case "logic-nand":
    case "logic-nor":
    case "logic-not":
      return <LogicGateSymbol type={type} powered={powered} />;
    case "hc-sr04":
      return <UltrasonicSymbol powered={powered} />;
    case "pir-sensor":
      return <PirSymbol powered={powered} motion={properties.motion === true} />;
    default:
      return <GenericSymbol type={type} powered={powered} />;
  }
}
