import { DEVICE_APIS, deviceInstances, splitDeviceArguments } from "./device-api.ts";
import type { SimulatorDiagnostic } from "./types.ts";

/** These are runtime adapters, not downloaded C++ libraries. */
export const SIMULATED_LIBRARIES: Readonly<Record<string, { className?: string; methods: readonly string[] }>> = {
  "Arduino.h": { methods: [] },
  "Servo.h": { className: "Servo", methods: ["attach", "write", "read"] },
  "LiquidCrystal.h": { className: "LiquidCrystal", methods: ["begin", "clear", "setCursor", "print", "println"] },
};
const coreCalls = new Set(["setup", "loop", "if", "for", "while", "switch", "pinMode", "digitalWrite", "analogWrite", "digitalRead", "analogRead", "millis", "delay", "pulseIn", "map", "constrain", "min", "max", "tone", "noTone", "shiftOut", "SPISettings", "isnan", "sizeof", "makeKeymap"]);

/** Input is comment-masked source, retaining newlines for actionable diagnostics. */
export function validateLibraryCalls(source: string, boardId?: string): SimulatorDiagnostic[] {
  source = source.replace(/\b([A-Za-z_]\w*)\.getResponse\(\)/g, "$1__response");
  const diagnostics: SimulatorDiagnostic[] = [];
  const lineAt = (index: number) => source.slice(0, index).split("\n").length;
  const supportedApis = DEVICE_APIS.filter(api => !boardId || !api.boards || api.boards.includes(boardId));
  for (const match of source.matchAll(/^\s*#\s*include\s*[<"]([^>"\r\n]+)[>"]/gm)) {
    if (!Object.hasOwn(SIMULATED_LIBRARIES, match[1]) && !supportedApis.some(api => api.header === match[1]) && !["Adafruit_Sensor.h"].includes(match[1])) {
      const platformApi = DEVICE_APIS.find(api => api.header === match[1]);
      const supportedBoards = [...new Set(DEVICE_APIS.filter(api => api.header === match[1]).flatMap(api => api.boards ?? []))];
      diagnostics.push({ severity: "error", code: platformApi && boardId ? "DEVICE_API_BOARD_UNSUPPORTED" : "UNSUPPORTED_LIBRARY", line: lineAt(match.index!), message: platformApi && boardId ? `${match[1]} is not available on ${boardId}${supportedBoards.length ? `; supported board profiles: ${supportedBoards.join(", ")}` : ""}.` : `${match[1]} has no browser simulation adapter. Use a registered simulation library.` });
    }
  }
  const instances = new Map<string, readonly string[]>([["Serial", ["begin", "print", "println"]]]);
  const deviceObjects = deviceInstances(source, boardId);
  const constructors = new Set<string>(supportedApis.map(api => api.type));
  for (const [name, instance] of deviceInstances(source, boardId)) { instances.set(name, Object.keys(instance.api.methods)); constructors.add(name); }
  for (const library of Object.values(SIMULATED_LIBRARIES)) {
    if (!library.className) continue;
    constructors.add(library.className);
    const declarations = new RegExp(`\\b${library.className}\\s+([A-Za-z_]\\w*)`, "g");
    for (const match of source.matchAll(declarations)) { instances.set(match[1], library.methods); constructors.add(match[1]); }
  }
  // Strings and preprocessor lines are data, not executable calls.
  const executable = source.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|^\s*#.*$/gm, text => text.replace(/[^\n]/g, " "));
  const registeredCallbacks = new Set([...executable.matchAll(/\bWire\s*\.\s*on(?:Receive|Request)\s*\(\s*([A-Za-z_]\w*)\s*\)/g)].map(match => match[1]));
  const seen = new Set<string>();
  for (const match of executable.matchAll(/\b([A-Za-z_]\w*)(?:\s*\.\s*([A-Za-z_]\w*))?\s*\(/g)) {
    const [, name, method] = match;
    const supported = method ? instances.get(name)?.includes(method) : coreCalls.has(name) || constructors.has(name) || registeredCallbacks.has(name);
    const label = method ? `${name}.${method}` : name;
    const signature = method && deviceObjects.get(name)?.api.methods[method];
    if (signature) {
      const start = match.index! + match[0].length;
      let end = start, depth = 1;
      for (; end < executable.length && depth; end++) {
        if (executable[end] === "(") depth++;
        if (executable[end] === ")") depth--;
      }
      // Count from the original source so a quoted argument is not mistaken for zero arguments.
      const count = splitDeviceArguments(source.slice(start, end - 1)).length;
      if (count < signature[0] || count > signature[1]) diagnostics.push({ severity: "error", code: "UNSUPPORTED_LIBRARY_OVERLOAD", line: lineAt(match.index!), message: `${label}() expects ${signature[0] === signature[1] ? signature[0] : `${signature[0]}–${signature[1]}`} argument(s); received ${count}. This overload has no simulation adapter.` });
    }
    if (!supported && !seen.has(label)) {
      seen.add(label);
      diagnostics.push({ severity: "error", code: "UNSUPPORTED_LIBRARY_CALL", line: lineAt(match.index!), message: `${label}() has no registered simulation implementation. Use a registered simulation call.` });
    }
  }
  return diagnostics;
}
