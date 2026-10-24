import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { BOARD_COMPONENTS } from "./boards.ts";
import { SCREENSHOT_COMPONENTS, SCREENSHOT_PART_IDS } from "./screenshot-components.ts";
import { pinPosition } from "../schematic/geometry.ts";
import { expandHorizontalHeader } from "./header-spacing.ts";
import {
  artworkActuatorEnergized,
  artworkDisplayLines,
  artworkFlowing,
  artworkJoystickOffset,
  artworkSpiActivityLines,
  artworkStepperAngle,
  clampArtworkAngle,
} from "./artwork-state.ts";
import {
  HARDWARE_ARTWORK_KIND,
  HARDWARE_BOARD_ARTWORK_KIND,
  getHardwareArtworkKind,
  getHardwareBoardArtworkKind,
  hasHardwareArtwork,
} from "./hardware-artwork.ts";

const artworkSourceUrl = new URL("../../app/component-artwork.tsx", import.meta.url);
const symbolSourceUrl = new URL("../../app/schematic-symbols.tsx", import.meta.url);
const studioSourceUrl = new URL("../../app/studio.tsx", import.meta.url);
const styleSourceUrl = new URL("../../app/schematic-symbols.css", import.meta.url);

test("every expanded catalog part has a dedicated hardware artwork kind and renderer case", async () => {
  const source = await readFile(artworkSourceUrl, "utf8");
  const kinds = Object.values(HARDWARE_ARTWORK_KIND);

  assert.deepEqual(
    Object.keys(HARDWARE_ARTWORK_KIND).sort(),
    [...SCREENSHOT_PART_IDS].sort(),
    "artwork registry must cover the complete expanded component catalog with no extras or omissions",
  );
  assert.equal(new Set(kinds).size, kinds.length, "each expanded part must select a variant-aware artwork kind");
  for (const [type, kind] of Object.entries(HARDWARE_ARTWORK_KIND)) {
    assert.equal(getHardwareArtworkKind(type), kind, `${type} resolves to its declared artwork`);
    assert.ok(hasHardwareArtwork(type), `${type} is enabled for canvas and palette artwork`);
    assert.ok(source.includes(`"${kind}"`), `${type} (${kind}) has an explicit renderer branch`);
  }
});

test("each newly added ESP32 board resolves to its own artwork, never the Pico renderer", async () => {
  const source = await readFile(artworkSourceUrl, "utf8");
  const newBoardIds = [
    "esp32-nodemcu-32s",
    "esp32-devkit-v1-30pin",
    "xiao-esp32s3-sense",
    "freenove-esp32s3-wroom",
  ] as const;

  assert.deepEqual(Object.keys(HARDWARE_BOARD_ARTWORK_KIND).sort(), [...newBoardIds].sort());
  for (const type of newBoardIds) {
    const kind = getHardwareBoardArtworkKind(type);
    assert.equal(kind, type, `${type} has variant-specific board artwork`);
    assert.ok(hasHardwareArtwork(type), `${type} is available in the library preview`);
    assert.ok(source.includes(`"${kind}"`), `${type} has a board renderer case`);
  }
  assert.match(source, /NodeMCU-32S · 2\.4 GHz/);
  assert.match(source, /DOIT · DEVKIT V1/);
  assert.match(source, /OV2640 CAMERA/);
  assert.match(source, /FREENOVE · ESP32-S3/);
  assert.doesNotMatch(source, /RASPBERRY PI PICO|RP2040/, "the new ESP32 artwork must not contain Pico internals");
});

test("hardware variants that look different physically use distinct artwork", () => {
  assert.notEqual(HARDWARE_ARTWORK_KIND["breadboard-half"], HARDWARE_ARTWORK_KIND["breadboard-full"]);
  assert.match(HARDWARE_ARTWORK_KIND["breadboard-half"], /breadboard-half/);
  assert.match(HARDWARE_ARTWORK_KIND["breadboard-full"], /breadboard-full/);
  assert.notEqual(HARDWARE_ARTWORK_KIND["ws2812b-strip-30"], HARDWARE_ARTWORK_KIND["ws2812b-strip-60"]);
  assert.notEqual(HARDWARE_ARTWORK_KIND["sg90-servo"], HARDWARE_ARTWORK_KIND["mg996r-servo"]);
  assert.notEqual(HARDWARE_ARTWORK_KIND["st7735s-tft-1-8"], HARDWARE_ARTWORK_KIND["ili9341-tft-2-8"]);
  assert.notEqual(HARDWARE_ARTWORK_KIND["epaper-2-9-spi"], HARDWARE_ARTWORK_KIND["gc9a01-round-tft"]);
});

test("every expanded part has an explicit pin anchor and canvas geometry uses it", () => {
  for (const type of SCREENSHOT_PART_IDS) {
    const part = SCREENSHOT_COMPONENTS[type];
    assert.ok(part, `${type} is present in the screenshot component catalog`);
    assert.ok(part.pins.length, `${type} has terminals`);
    for (const pin of part.pins) {
      assert.ok(pin.anchor, `${type}.${pin.id} needs an artwork-aligned anchor`);
      assert.ok(Number.isFinite(pin.anchor.x) && Number.isFinite(pin.anchor.y), `${type}.${pin.id} anchor is finite`);
      assert.ok(pin.anchor.x >= 0 && pin.anchor.x <= part.width, `${type}.${pin.id} anchor is within the artwork width`);
      assert.ok(pin.anchor.y >= 0 && pin.anchor.y <= part.height, `${type}.${pin.id} anchor is within the artwork height`);
      assert.deepEqual(
        pinPosition({ type, x: 37, y: 91 }, pin.id, part),
        { x: 37 + pin.anchor.x, y: 91 + pin.anchor.y },
        `${type}.${pin.id} wire endpoint follows its artwork anchor`,
      );
    }
  }
});

test("SH1107 pins use its bottom header and the 30-pin DevKit pins sit on the drawn header holes", () => {
  const oled = SCREENSHOT_COMPONENTS["sh1107-oled-128x128"]!;
  assert.ok(oled.pins.every(pin => pin.side === "bottom"));
  assert.equal(new Set(oled.pins.map(pin => pin.anchor?.y)).size, 1);
  assert.deepEqual(oled.pins.map(pin => pin.anchor?.x), [...oled.pins].map(pin => pin.anchor!.x).sort((a, b) => a - b));

  const board = BOARD_COMPONENTS["esp32-devkit-v1-30pin"]!;
  const width = board.width;
  const height = board.height;
  const scale = Math.min(width / 220, (height - 6) / height);
  const offsetX = (width - 220 * scale) / 2;
  const expectedLeftX = offsetX + 42 * scale;
  const expectedRightX = offsetX + 178 * scale;
  for (const pin of board.pins) {
    assert.ok(pin.anchor, `${pin.id} has a board-artwork terminal`);
    assert.ok(Math.abs(pin.anchor.x - (pin.side === "left" ? expectedLeftX : expectedRightX)) < 1e-6, `${pin.id} is on its physical header row`);
  }
});

test("tight horizontal headers have plain, adjacent labels with enough room", async () => {
  const oled = SCREENSHOT_COMPONENTS["sh1107-oled-128x128"]!;
  const oledXs = oled.pins.map(pin => pin.anchor!.x).sort((a, b) => a - b);
  assert.ok(oledXs.slice(1).every((x, index) => x - oledXs[index]! >= 21), "SH1107 terminals are visibly spread along its existing bottom edge");
  assert.ok(oledXs[0]! < oledXs[1]! && oledXs[2]! < oledXs[3]!, "each name remains beside its own terminal in order");

  for (const definition of Object.values(SCREENSHOT_COMPONENTS)) {
    for (const side of ["top", "bottom"] as const) {
      const pins = definition.pins.filter(pin => pin.side === side && pin.anchor);
      if (pins.length < 2) continue;
      const ordered = [...pins].sort((a, b) => a.anchor!.x - b.anchor!.x);
      for (let index = 1; index < ordered.length; index += 1) {
        const previous = ordered[index - 1]!;
        const current = ordered[index]!;
        const gap = current.anchor!.x - previous.anchor!.x;
        const labelWidth = (previous.label.length + current.label.length) / 2 * 6.5 * 0.6;
        assert.ok(gap + 1e-6 >= labelWidth + 2, `${definition.id} ${previous.label}/${current.label} have room for plain adjacent labels`);
      }
    }
  }

  assert.deepEqual(expandHorizontalHeader(75, 4, 10), { x: 57, spacing: 22 });
  assert.deepEqual(expandHorizontalHeader(95, 4, 10), { x: 77, spacing: 22 });
  const [studio, styles, artwork] = await Promise.all([
    readFile(studioSourceUrl, "utf8"),
    readFile(styleSourceUrl, "utf8"),
    readFile(artworkSourceUrl, "utf8"),
  ]);
  assert.doesNotMatch(studio, /layoutPinLabels|pin-label-offset|pin-leader-length/);
  assert.doesNotMatch(styles, /pin-label-spread|pin-label-hover|pin-leader/);
  assert.match(artwork, /Header x=\{95\} y=\{137\} count=\{4\} vertical=\{false\}/);
});

test("the same dedicated artwork is wired into the schematic and component-library previews", async () => {
  const [symbols, studio, styles, source] = await Promise.all([
    readFile(symbolSourceUrl, "utf8"),
    readFile(studioSourceUrl, "utf8"),
    readFile(styleSourceUrl, "utf8"),
    readFile(artworkSourceUrl, "utf8"),
  ]);

  assert.match(symbols, /getHardwareArtworkKind\(type\)\) return <HardwarePartArtwork type=\{type\} state=\{state\} servoAngle=\{servoAngle\} simulationStatus=\{simulationStatus\} \/>/);
  assert.match(symbols, /<HardwareBoardArtwork type=\{type\} powered=\{powered\} \/>/);
  assert.match(symbols, /!getHardwareArtworkKind\(type\) && <div className="symbol-registry__body"/);
  assert.match(symbols, /!getHardwareArtworkKind\(type\) && definition\.pins\.map/);
  assert.match(studio, /hasHardwareArtwork\(part\.id\) \? <HardwareArtworkPreview type=\{part\.id\} \/>/);
  assert.match(studio, /isBoardType\(component\.type\) \? "is-board-component"/);
  assert.match(studio, /const showLabels = !definition\?\.symbol \|\| isBoard \|\| hasArtwork/);
  assert.match(studio, /<div className="schematic-pin-layer"/);
  assert.match(styles, /\.hardware-part-artwork \{/);
  assert.match(styles, /\.hardware-board-artwork \{/);
  assert.match(styles, /\.component-breadboard-half \.schematic-pin\.side-left \{ flex-direction: row-reverse; \}/);
  assert.match(styles, /\.component-breadboard-half \.schematic-pin\.side-right \{ flex-direction: row; transform: translate\(0, -50%\); \}/);
  assert.match(styles, /\.component-freenove-esp32s3-wroom \.schematic-pin\.side-left \{ flex-direction: row-reverse; \}/);
  assert.match(styles, /\.schematic-pin-group\.is-board-component \.schematic-pin\.side-left \{ flex-direction: row-reverse; transform: translate\(-100%, -50%\); \}/);
  assert.match(styles, /\.schematic-pin-layer \{ position:absolute; z-index:8;/);
  assert.doesNotMatch(styles, /pin-label-spread|pin-label-hover|pin-leader/);
  assert.match(styles, /schematic-pin-group\.has-hardware-artwork \.schematic-pin\.side-bottom span \{ font-size:6\.5px/);
  assert.match(source, /const rows = full \? 63 : 30;/);
  assert.match(source, /kind === "breadboard-full" \? "0 0 220 430" : kind === "breadboard-half" \? "0 0 220 260"/);
  assert.match(source, /kind === "xiao-esp32s3-sense" \? 240/);
  assert.match(source, /kind === "esp32-devkit-v1-30pin" \? 367/);
  assert.match(source, /kind === "esp32-nodemcu-32s" \? 443/);
  assert.doesNotMatch(source, /default:\s*return standardBoard\(\)/, "unknown parts must not become a generic sensor breakout");
});

test("live component artwork derives moving parts and displays from simulator output", async () => {
  const [studio, symbols, source, styles] = await Promise.all([
    readFile(studioSourceUrl, "utf8"),
    readFile(symbolSourceUrl, "utf8"),
    readFile(artworkSourceUrl, "utf8"),
    readFile(styleSourceUrl, "utf8"),
  ]);

  assert.match(studio, /servoCommandActive \? servoState!\.angle : Number\(component\.properties\?\.angle \?\? 90\)/,
    "schematic servo artwork follows the matching powered circuit command, not the 3D pose");
  assert.match(studio, /__servoCommandActive: servoCommandActive/);
  assert.doesNotMatch(studio, /physicalServoAngle|angle: renderedPhysicsFrame\?\.actuatorAngles/);
  assert.match(symbols, /const servoAngle = useServoVisualAngle\(/,
    "schematic servo visuals use a separate smoothed display angle");
  assert.match(symbols, /commandAngle: isServo && properties\.__servoCommandActive === true \? configuredServoAngle : undefined/,
    "only powered simulator command targets animate the horn");
  assert.match(symbols, /angle=\{servoAngle\}/);
  assert.match(symbols, /servoAngle=\{servoAngle\} simulationStatus=\{simulationStatus\}/);
  assert.match(source, /<ServoHorn variant="sg90" angle=\{servoAngle\} cx=\{110\} cy=\{69\}>/);
  assert.match(source, /<ServoHorn variant="mg996r" angle=\{servoAngle\} cx=\{110\} cy=\{49\}>/);
  assert.match(source, /rotate\(\$\{angle\} 110 34\)/);
  assert.match(source, /rotate\(\$\{angle\} 110 77\)/);
  assert.match(source, /state\?\.display\?\.\[row\]\?\.\[column\]/);
  assert.match(source, /displayedLines\[0\]/);
  assert.match(source, /artworkSpiActivityLines\(state\)/);
  assert.match(source, /artworkActuatorEnergized\(state\)/);
  assert.match(source, /artworkFlowing\(state\)/);
  assert.match(source, /artworkJoystickOffset\(state\?\.readings\?\.x\)/);
  assert.match(styles, /hardware-part-artwork--running \.hardware-artwork__rotor\.is-energized/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

test("2D servo artwork displays smoothed sketch commands without a scene runtime", async () => {
  const [artwork, symbols, studio] = await Promise.all([
    readFile(artworkSourceUrl, "utf8"),
    readFile(symbolSourceUrl, "utf8"),
    readFile(studioSourceUrl, "utf8"),
  ]);

  assert.match(studio, /snapshot\.servos\.find\(\(servo\) => servo\.attached && resolveComponentBoardPinEndpoints/,
    "2D servo targets are matched to the attached sketch command");
  assert.match(studio, /const servoCommandActive = Boolean\(servoState && electricalState\?\.powered\)/,
    "only a powered servo signal drives the schematic animation");
  assert.match(studio, /resolveComponentBoardPinEndpoints\(project, component\.id, "SIG"\)/);
  assert.match(studio, /resolveBoardPin\(pin\.boardId, pin\.pin\) === servo\.pin/,
    "servo targets must match the wired board pin");
  assert.match(artwork, /function ServoHorn\(/);
  assert.match(artwork, /transform=\{`rotate\(\$\{angle - 90\} \$\{cx\} \$\{cy\}\)`\}/,
    "component artwork renders the smoothed display angle");
  assert.match(symbols, /function ServoSymbol\(\{ powered, angle \}/,
    "2D servo artwork receives its independently animated display angle");
  assert.match(symbols, /"--symbol-servo-angle": `\$\{angle - 90\}deg`/,
    "schematic servo artwork animates the horn without a separate physics state");
  assert.match(symbols, /useServoVisualAngle/);
  assert.doesNotMatch(symbols, /physicsFrameRef|actuatorAngles/,
    "there is no separate scene physics state to alter the 2D servo artwork");
  assert.doesNotMatch(studio, /CircuitSceneCanvas|scene-physics|generateScene/);
});

test("schematic parts do not render floating simulator-status badges", async () => {
  const [symbols, styles, studio] = await Promise.all([
    readFile(symbolSourceUrl, "utf8"),
    readFile(styleSourceUrl, "utf8"),
    readFile(studioSourceUrl, "utf8"),
  ]);

  assert.doesNotMatch(symbols, /symbol-registry__state|symbol-motor__status/, "status and numeric readings must not float over the schematic");
  assert.doesNotMatch(styles, /symbol-registry__state|symbol-motor__status|motor-badge-scale/);
  assert.match(symbols, /<RegisteredPartArtwork type=\{type\} state=\{state\} \/>/, "simulation state still drives on-part artwork without floating status props");
  assert.match(symbols, /symbol-motor__rotor/, "motor motion remains represented by the motor itself");
  assert.match(studio, /DeviceFeedback key=\{selected\.id\} component=\{selected\} state=\{snapshot\.componentStates\[selected\.id\]\}/, "detailed readings remain available in the inspector");
});

test("artwork state adapters preserve simulator values and reject inactive output", () => {
  assert.equal(clampArtworkAngle(225, 0, 180), 180);
  assert.equal(clampArtworkAngle(Number.NaN, 90, 180), 90);
  assert.equal(artworkStepperAngle({ type: "stepper-28byj-48", powered: true, readings: { angleDegrees: 135 } }), 135);
  assert.deepEqual(artworkDisplayLines({ type: "tm1637-4-digit-display", powered: true, display: [" 42 ", ""] }), [" 42", ""]);
  assert.deepEqual(artworkSpiActivityLines({ type: "st7735s-tft-1-8", powered: true, readings: { spiBytes: 7 } }), ["SIM SPI TX", "7 BYTES"]);
  assert.deepEqual(artworkSpiActivityLines({ type: "st7735s-tft-1-8", powered: false, readings: { spiBytes: 7 } }), []);
  assert.equal(artworkActuatorEnergized({ type: "r385-water-pump", powered: true, channels: { energized: 1 } }), true);
  assert.equal(artworkActuatorEnergized({ type: "r385-water-pump", powered: true, status: "Ready" }), false);
  assert.equal(artworkActuatorEnergized({ type: "r385-water-pump", powered: false, status: "Energized" }), false);
  assert.equal(artworkFlowing({ type: "yf-s201-water-flow-sensor", powered: true, readings: { flowLpm: 3 } }), true);
  assert.equal(artworkFlowing({ type: "yf-s201-water-flow-sensor", powered: true, readings: { flowLpm: 0 } }), false);
  assert.equal(artworkJoystickOffset(100), 12);
  assert.equal(artworkJoystickOffset(0), -12);
});
