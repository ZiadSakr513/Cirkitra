import { boardApiConstants } from "../circuit/boards.ts";
import { SIMULATOR_CAPABILITY_REGISTRY } from "./capabilities.ts";
import { compileArduinoSketch } from "./parser.ts";
import type { SimulatorDiagnostic } from "./types.ts";

/** One bounded expression in the documented simulator grammar. Statements and
 * control flow remain structured; expression text is checked as a single
 * expression and then compiled with the complete rendered sketch. */
export type ProgramExpression = string;

export type ProgramSimpleStatement =
  | { kind: "declare"; type: string; name: string; initializer?: ProgramExpression; arraySize?: ProgramExpression; values?: ProgramExpression[]; constant?: boolean }
  | { kind: "assign"; target: ProgramExpression; operator: string; value?: ProgramExpression }
  | { kind: "call"; callee: string; arguments: ProgramExpression[] };

export type ProgramStatement = ProgramSimpleStatement
  | { kind: "if"; condition: ProgramExpression; then: ProgramStatement[]; otherwise?: ProgramStatement[] }
  | { kind: "for"; init?: ProgramSimpleStatement; condition?: ProgramExpression; update?: ProgramSimpleStatement; body: ProgramStatement[] }
  | { kind: "return"; value?: ProgramExpression };

export type SketchProgram = {
  headers: string[];
  objects: Array<{ type: string; name: string; arguments: ProgramExpression[] }>;
  globals: Array<Extract<ProgramSimpleStatement, { kind: "declare" }>>;
  functions: Array<{
    name: string;
    returnType: string;
    parameters: Array<{ type: string; name: string }>;
    body: ProgramStatement[];
  }>;
};

export type ValidatedSketchProgram = { program: SketchProgram; code: string; diagnostics: SimulatorDiagnostic[] };
export type SketchProgramValidation = { ok: true; value: ValidatedSketchProgram } | { ok: false; issues: string[] };

const IDENTIFIER = /^[A-Za-z_]\w*$/;
const CALL_TARGET = /^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*(?:\(\)\.[A-Za-z_]\w*)?$/;
const ASSIGNMENT_OPERATORS = new Set(["=", "+=", "-=", "*=", "/=", "%=", "++", "--"]);
const NUMERIC_TYPES = new Set(SIMULATOR_CAPABILITY_REGISTRY.coreTypes.filter(type => type !== "void" && type !== "char"));
const API_METHODS_BY_CLASS = new Map<string, typeof SIMULATOR_CAPABILITY_REGISTRY.deviceApis[number][]>();
for (const api of SIMULATOR_CAPABILITY_REGISTRY.deviceApis) {
  const entries = API_METHODS_BY_CLASS.get(api.type) ?? [];
  entries.push(api);
  API_METHODS_BY_CLASS.set(api.type, entries);
}
const SINGLETON_METHODS: Readonly<Record<string, Readonly<Record<string, readonly [number, number]>>>> = {
  ...Object.fromEntries(Object.entries(SIMULATOR_CAPABILITY_REGISTRY.builtinSingletons).map(([name, definition]) => [name, definition.methods])),
  ...Object.fromEntries(SIMULATOR_CAPABILITY_REGISTRY.deviceApis.flatMap(api => api.singleton ? [[api.singleton, api.methods]] : [])),
};
const LIBRARY_METHODS = SIMULATOR_CAPABILITY_REGISTRY.libraryMethodSignatures;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A bounded JSON schema keeps the model's output in a renderable C++ subset. */
type SketchHeaderPart = {
  id: string;
  metadata?: {
    interfaces?: readonly string[];
    libraries?: readonly { headers: readonly string[] }[];
  };
};

/** Return only headers supported by the selected board and planned parts. */
export function sketchProgramHeaders(boardId: string, parts?: readonly SketchHeaderPart[]): string[] {
  if (!parts) return [...new Set([
    ...Object.keys(SIMULATOR_CAPABILITY_REGISTRY.libraries),
    ...SIMULATOR_CAPABILITY_REGISTRY.deviceApis.filter(api => boardId === "all" || !api.boards || api.boards.includes(boardId)).map(api => api.header),
    ...SIMULATOR_CAPABILITY_REGISTRY.extraHeaders,
  ])];

  const partTypes = new Set(parts.map(part => part.id));
  const declaredHeaders = new Set(parts.flatMap(part => part.metadata?.libraries?.flatMap(library => library.headers) ?? []));
  const interfaceHeaders: Readonly<Record<string, string>> = { I2C: "Wire.h", SPI: "SPI.h", UART: "SoftwareSerial.h" };
  const declaredInterfaces = new Set(parts.flatMap(part => part.metadata?.interfaces ?? []));
  const headers = new Set<string>(["Arduino.h", ...declaredHeaders]);
  for (const [interfaceName, header] of Object.entries(interfaceHeaders)) {
    if (declaredInterfaces.has(interfaceName)) headers.add(header);
  }
  for (const api of SIMULATOR_CAPABILITY_REGISTRY.deviceApis) {
    if (boardId !== "all" && api.boards && !api.boards.includes(boardId)) continue;
    const relevant = api.component
      ? partTypes.has(api.component)
      : declaredHeaders.has(api.header) || (api.header === "Wire.h" && declaredInterfaces.has("I2C")) || (api.header === "SPI.h" && declaredInterfaces.has("SPI")) || (api.header === "SoftwareSerial.h" && declaredInterfaces.has("UART"));
    if (relevant) headers.add(api.header);
  }
  return [...headers];
}

export function sketchProgramSchema(
  boardId: string,
  allowedHeaders?: readonly string[],
  options: { compact?: boolean } = {},
) {
  const headers = allowedHeaders ? [...new Set(allowedHeaders)] : sketchProgramHeaders(boardId);
  const expression = options.compact ? { type: "string" } : {
    type: "string",
    description: "One valid C++ expression in the Cirkitra simulator grammar. String literals must include escaped double quotes, for example \"\\\"Sensor unavailable\\\"\" in JSON. Do not put bare prose in an expression.",
  };
  const globalTypes = [...new Set([...NUMERIC_TYPES, "DeviceAddress", "sensors_event_t", "char"])];
  const simpleStatementKinds = ["declare", "assign", "call"];
  const simpleStatement = {
    type: "object",
    properties: {
      kind: { type: "string", enum: simpleStatementKinds },
      type: { type: "string" }, name: { type: "string" },
      initializer: expression, arraySize: expression,
      values: { type: "array", items: expression }, constant: { type: "boolean" },
      target: expression, operator: { type: "string", enum: [...ASSIGNMENT_OPERATORS] }, value: expression,
      callee: { type: "string" }, arguments: { type: "array", items: expression },
    },
    required: ["kind"],
  };
  const globalDeclaration = {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["declare"] },
      type: { type: "string", enum: globalTypes },
      name: { type: "string" }, initializer: expression, arraySize: expression,
      values: { type: "array", items: expression }, constant: { type: "boolean" },
    },
    required: ["kind", "type", "name"],
  };
  const statement = {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["declare", "assign", "call", "if", "for", "return"] },
      type: { type: "string" }, name: { type: "string" },
      initializer: expression, arraySize: expression,
      values: { type: "array", items: expression }, constant: { type: "boolean" },
      target: expression, operator: { type: "string", enum: [...ASSIGNMENT_OPERATORS] }, value: expression,
      callee: { type: "string" }, arguments: { type: "array", items: expression },
      condition: expression,
      then: { type: "array", maxItems: 200, items: simpleStatement },
      otherwise: { type: "array", maxItems: 200, items: simpleStatement },
      init: simpleStatement, update: simpleStatement,
      body: { type: "array", maxItems: 200, items: simpleStatement },
    },
    required: ["kind"],
  };
  return {
    type: "object",
    properties: {
      headers: { type: "array", maxItems: 24, items: { type: "string", enum: headers } },
      objects: { type: "array", maxItems: 80, items: { type: "object", properties: {
        type: { type: "string" }, name: { type: "string" }, arguments: { type: "array", items: expression },
      }, required: ["type", "name", "arguments"] } },
      globals: { type: "array", maxItems: 100, items: globalDeclaration },
      functions: { type: "array", minItems: 2, maxItems: 32, items: { type: "object", properties: {
        name: { type: "string" }, returnType: { type: "string" },
        parameters: { type: "array", items: { type: "object", properties: { type: { type: "string" }, name: { type: "string" } }, required: ["type", "name"] } },
        body: { type: "array", maxItems: 200, items: statement },
      }, required: ["name", "returnType", "parameters", "body"] } },
    },
    required: ["headers", "objects", "globals", "functions"],
  };
}

export function renderProgramExpression(expression: ProgramExpression): string {
  return expression;
}

function renderSimpleStatement(statement: ProgramSimpleStatement): string {
  if (statement.kind === "call") return statement.callee + "(" + statement.arguments.map(renderProgramExpression).join(", ") + ")";
  if (statement.kind === "assign") {
    const target = renderProgramExpression(statement.target);
    if (statement.operator === "++" || statement.operator === "--") return target + statement.operator;
    return target + " " + statement.operator + " " + renderProgramExpression(statement.value!);
  }
  const qualifier = statement.constant ? "const " : "";
  const array = statement.arraySize ? "[" + renderProgramExpression(statement.arraySize) + "]" : "";
  const initializer = statement.values ? "{" + statement.values.map(renderProgramExpression).join(", ") + "}" : statement.initializer ? renderProgramExpression(statement.initializer) : "";
  return qualifier + statement.type + " " + statement.name + array + (initializer ? " = " + initializer : "");
}

function renderStatement(statement: ProgramStatement, depth: number): string {
  const indent = "  ".repeat(depth);
  if (statement.kind === "if") {
    const then = statement.then.map(item => renderStatement(item, depth + 1)).join("\n");
    const otherwise = statement.otherwise?.length ? " else {\n" + statement.otherwise.map(item => renderStatement(item, depth + 1)).join("\n") + "\n" + indent + "}" : "";
    return indent + "if (" + renderProgramExpression(statement.condition) + ") {\n" + then + "\n" + indent + "}" + otherwise;
  }
  if (statement.kind === "for") {
    const initialize = statement.init ? renderSimpleStatement(statement.init) : "";
    const condition = statement.condition ? renderProgramExpression(statement.condition) : "";
    const update = statement.update ? renderSimpleStatement(statement.update) : "";
    return indent + "for (" + initialize + "; " + condition + "; " + update + ") {\n" + statement.body.map(item => renderStatement(item, depth + 1)).join("\n") + "\n" + indent + "}";
  }
  if (statement.kind === "return") return indent + "return" + (statement.value ? " " + renderProgramExpression(statement.value) : "") + ";";
  return indent + renderSimpleStatement(statement) + ";";
}

export function renderSketchProgram(program: SketchProgram): string {
  const sections: string[] = [];
  if (program.headers.length) sections.push(program.headers.map(header => "#include <" + header + ">").join("\n"));
  if (program.globals.length) sections.push(program.globals.map(global => renderSimpleStatement(global) + ";").join("\n"));
  if (program.objects.length) sections.push(program.objects.map(object => object.type + " " + object.name + "(" + object.arguments.map(renderProgramExpression).join(", ") + ");").join("\n"));
  const functions = [...program.functions].sort((left, right) => {
    const rank = (name: string) => name === "setup" ? 1 : name === "loop" ? 2 : 0;
    return rank(left.name) - rank(right.name);
  });
  sections.push(functions.map(fn => {
    const params = fn.parameters.map(parameter => parameter.type + " " + parameter.name).join(", ");
    return fn.returnType + " " + fn.name + "(" + params + ") {\n" + fn.body.map(statement => renderStatement(statement, 1)).join("\n") + "\n}";
  }).join("\n\n"));
  return sections.filter(Boolean).join("\n\n");
}

function replaceExpressionIdentifiers(expression: string, replacements: Readonly<Record<string, string>>): { value: string; changed: string[] } {
  let value = "";
  const changed = new Set<string>();
  let state: "code" | "string" | "char" = "code";
  for (let index = 0; index < expression.length;) {
    const current = expression[index]!;
    if (state !== "code") {
      value += current;
      index += 1;
      if (current === "\\" && index < expression.length) { value += expression[index]!; index += 1; }
      else if ((state === "string" && current === '"') || (state === "char" && current === "'")) state = "code";
      continue;
    }
    if (current === '"') { value += current; index += 1; state = "string"; continue; }
    if (current === "'") { value += current; index += 1; state = "char"; continue; }
    if (/[A-Za-z_]/.test(current)) {
      let end = index + 1;
      while (end < expression.length && /[A-Za-z0-9_]/.test(expression[end]!)) end += 1;
      const identifier = expression.slice(index, end);
      const replacement = replacements[identifier];
      value += replacement ?? identifier;
      if (replacement !== undefined) changed.add(identifier);
      index = end;
      continue;
    }
    value += current;
    index += 1;
  }
  return { value, changed: [...changed] };
}

/** Apply only existing, board-specific simulator aliases to a structured
 * sketch before validation. These transformations preserve the model's logic
 * and are reported as warnings when they alter its program. */
export function normalizeSketchProgramForSimulator(value: SketchProgram, boardId: string): { program: SketchProgram; warnings: string[] } {
  const warnings = new Set<string>();
  if (!isRecord(value)
    || !Array.isArray(value.headers)
    || !Array.isArray(value.objects)
    || !Array.isArray(value.globals)
    || !Array.isArray(value.functions)) return { program: value, warnings: [] };
  const replacements: Record<string, string> = {};
  if (boardId === "arduino-uno") {
    for (let pin = 0; pin <= 13; pin += 1) replacements[`D${pin}`] = String(pin);
  }
  if (boardId === "esp32-devkitc-v4") replacements.Serial2 = "Serial1";
  const normalizeExpression = (expression: string): string => {
    if (typeof expression !== "string") return expression;
    const result = replaceExpressionIdentifiers(expression, replacements);
    if (result.changed.includes("Serial2")) warnings.add("The simulator exposes the ESP32 wired UART on GPIO16/GPIO17 as Serial1; generated Serial2 references were adapted to that supported simulator port.");
    return result.value;
  };
  const normalizeSimple = (statement: ProgramSimpleStatement): ProgramSimpleStatement => {
    if (!isRecord(statement) || typeof statement.kind !== "string") return statement;
    if (statement.kind === "call") {
      const callee = normalizeExpression(statement.callee);
      if (!Array.isArray(statement.arguments)) return statement;
      let args = statement.arguments.map(normalizeExpression);
      // Gemini occasionally puts a plain-English label in an expression field
      // without C++ quotes. For a single-argument print call, an identifier-only
      // multiword phrase is unambiguously display text; quote only that narrow
      // case and keep all logic expressions subject to the normal validator.
      if (/^(?:Serial|[A-Za-z_]\w*)\.(?:print|println)$/.test(callee)
        && args.length === 1
        && /^[A-Za-z_]\w*(?:[ ]+[A-Za-z_]\w*)+$/.test(args[0]!)) {
        args = [JSON.stringify(args[0]!)];
        warnings.add("An unquoted multiword label in a Serial or display print call was rendered as a C++ string literal.");
      }
      if (boardId === "esp32-devkitc-v4" && callee === "Serial1.begin" && args.length === 4) {
        const profile = SIMULATOR_CAPABILITY_REGISTRY.boards[boardId];
        const parsePin = (expression: string) => {
          const token = expression.trim();
          if (/^\d+$/.test(token)) return Number(token);
          return boardApiConstants(boardId)[token];
        };
        const uart = profile.uart[1];
        if (uart && parsePin(args[2]!) === uart.rx && parsePin(args[3]!) === uart.tx) {
          args = [args[0]!];
          warnings.add("The simulator's ESP32 UART1 adapter uses GPIO16 for RX and GPIO17 for TX; a matching explicit begin() pin overload was simplified to Serial1.begin(baud).");
        }
      }
      return { ...statement, callee, arguments: args };
    }
    if (statement.kind === "assign") return {
      ...statement,
      target: normalizeExpression(statement.target),
      ...(statement.value !== undefined ? { value: normalizeExpression(statement.value) } : {}),
    };
    return {
      ...statement,
      ...(statement.initializer !== undefined ? { initializer: normalizeExpression(statement.initializer) } : {}),
      ...(statement.arraySize !== undefined ? { arraySize: normalizeExpression(statement.arraySize) } : {}),
      ...(statement.values !== undefined ? { values: statement.values.map(normalizeExpression) } : {}),
    };
  };
  const normalizeStatements = (statements: readonly ProgramStatement[]): ProgramStatement[] => statements.map(statement => {
    if (!isRecord(statement) || typeof statement.kind !== "string") return statement;
    if (statement.kind === "if") {
      if (typeof statement.condition !== "string" || !Array.isArray(statement.then)) return statement;
      return {
      ...statement,
      condition: normalizeExpression(statement.condition),
      then: normalizeStatements(statement.then),
      ...(Array.isArray(statement.otherwise) ? { otherwise: normalizeStatements(statement.otherwise) } : {}),
      };
    }
    if (statement.kind === "for") {
      if (!Array.isArray(statement.body)) return statement;
      return {
      ...statement,
      ...(isRecord(statement.init) ? { init: normalizeSimple(statement.init as ProgramSimpleStatement) } : {}),
      ...(statement.condition !== undefined ? { condition: normalizeExpression(statement.condition) } : {}),
      ...(isRecord(statement.update) ? { update: normalizeSimple(statement.update as ProgramSimpleStatement) } : {}),
      body: normalizeStatements(statement.body),
      };
    }
    if (statement.kind === "return") return { ...statement, ...(typeof statement.value === "string" ? { value: normalizeExpression(statement.value) } : {}) };
    if (!["declare", "assign", "call"].includes(statement.kind)) return statement;
    return normalizeSimple(statement);
  });
  const program: SketchProgram = {
    headers: [...value.headers],
    objects: value.objects.map(object => isRecord(object) && Array.isArray(object.arguments)
      ? { ...object, arguments: object.arguments.map(argument => typeof argument === "string" ? normalizeExpression(argument) : argument) } as SketchProgram["objects"][number]
      : object),
    globals: value.globals.map(statement => normalizeSimple(statement) as Extract<ProgramSimpleStatement, { kind: "declare" }>),
    functions: value.functions.map(fn => {
      if (!isRecord(fn)) return fn;
      return {
        ...fn,
        parameters: Array.isArray(fn.parameters) ? fn.parameters.map(parameter => isRecord(parameter) ? { ...parameter } : parameter) : fn.parameters,
        body: Array.isArray(fn.body) ? normalizeStatements(fn.body as ProgramStatement[]) : fn.body,
      } as SketchProgram["functions"][number];
    }),
  };
  return { program, warnings: [...warnings] };
}

function validateExpression(value: unknown, names: ReadonlySet<string>, path: string, issues: string[]): value is ProgramExpression {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    issues.push(path + " must be one non-empty expression under 512 characters");
    return false;
  }
  const withoutLiterals = value.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, "0");
  if (/[^A-Za-z0-9_\s.+\-*/%<>=!&|^~(),?:\[\]]/.test(withoutLiterals) || /[;{}#]/.test(withoutLiterals)) {
    issues.push(path + " contains syntax outside the simulator expression grammar");
    return false;
  }
  let parens = 0;
  let brackets = 0;
  for (const character of withoutLiterals) {
    if (character === "(") parens += 1;
    else if (character === ")" && --parens < 0) break;
    else if (character === "[") brackets += 1;
    else if (character === "]" && --brackets < 0) break;
  }
  if (parens !== 0 || brackets !== 0 || /(^|[^=!<>])=(?!=)/.test(withoutLiterals)) {
    issues.push(path + " must be a balanced expression without assignments or statements");
    return false;
  }
  const tokens = [...withoutLiterals.matchAll(/0[xX][\da-fA-F]+|\d+(?:\.\d+)?(?:[uUlLfF]+)?|[A-Za-z_]\w*/g)];
  for (const match of tokens) {
    const token = match[0];
    if (/^(?:0[xX]|\d)/.test(token) || token === "true" || token === "false") continue;
    const before = withoutLiterals.slice(0, match.index).trimEnd();
    const after = withoutLiterals.slice(match.index! + token.length).trimStart();
    if (before.endsWith(".") || after.startsWith("(")) continue;
    if (!names.has(token)) issues.push(path + " references unknown name " + token);
  }
  return true;
}

function validateCall(callee: string, argumentCount: number, boardId: string, objectTypes: ReadonlyMap<string, string>, helperFunctions: ReadonlyMap<string, { parameters: number; callback: boolean }>, path: string, issues: string[]) {
  const responseChain = /^([A-Za-z_]\w*)\.getResponse\(\)\.([A-Za-z_]\w*)$/.exec(callee);
  if (responseChain) {
    const responseType = objectTypes.get(responseChain[1] + "__response");
    const api = responseType ? API_METHODS_BY_CLASS.get(responseType)?.find(candidate => !candidate.boards || candidate.boards.includes(boardId)) : undefined;
    const signature = api?.methods[responseChain[2]];
    if (!signature) { issues.push(path + " calls unsupported " + callee + "() for " + boardId); return; }
    if (argumentCount < signature[0] || argumentCount > signature[1]) issues.push(path + " calls " + callee + "() with " + argumentCount + " argument(s), but the registered adapter accepts " + (signature[0] === signature[1] ? signature[0] : signature[0] + " to " + signature[1]));
    return;
  }
  const [owner, method] = callee.includes(".") ? callee.split(".") as [string, string] : ["", callee];
  let signature: readonly [number, number] | undefined;
  if (owner) {
    const singleton = SINGLETON_METHODS[owner];
    if (singleton) signature = singleton[method];
    else {
      const objectType = objectTypes.get(owner);
      const api = objectType ? API_METHODS_BY_CLASS.get(objectType)?.find(candidate => !candidate.boards || candidate.boards.includes(boardId)) : undefined;
      if (api) signature = api.methods[method];
      else if (objectType === "XBee" && method === "getResponse") signature = [0, 0];
      else if (objectType) signature = LIBRARY_METHODS[objectType as keyof typeof LIBRARY_METHODS]?.[method as keyof (typeof LIBRARY_METHODS)[keyof typeof LIBRARY_METHODS]];
    }
  } else {
    const core = SIMULATOR_CAPABILITY_REGISTRY.coreFunctions[method as keyof typeof SIMULATOR_CAPABILITY_REGISTRY.coreFunctions];
    if (core) signature = core;
    const helper = helperFunctions.get(method);
    if (helper) signature = [helper.parameters, helper.parameters];
  }
  if (!signature) { issues.push(path + " calls unsupported " + callee + "() for " + boardId); return; }
  if (argumentCount < signature[0] || argumentCount > signature[1]) issues.push(path + " calls " + callee + "() with " + argumentCount + " argument(s), but the registered adapter accepts " + (signature[0] === signature[1] ? signature[0] : signature[0] + " to " + signature[1]));
}

function validateStatements(value: unknown, names: Set<string>, boardId: string, objectTypes: Map<string, string>, helperFunctions: ReadonlyMap<string, { parameters: number; callback: boolean }>, path: string, issues: string[], depth = 0, stats = { count: 0 }): value is ProgramStatement[] {
  if (!Array.isArray(value) || value.length > 200) { issues.push(path + " must contain at most 200 statements"); return false; }
  if (depth > 8) { issues.push(path + " exceeds the control-flow nesting limit"); return false; }
  for (const [index, item] of value.entries()) {
    stats.count++;
    if (stats.count > 800) { issues.push("program contains too many statements"); return false; }
    const itemPath = path + "[" + index + "]";
    if (!isRecord(item) || typeof item.kind !== "string") { issues.push(itemPath + " must be a typed statement"); continue; }
    if (item.kind === "declare") {
      if (typeof item.type !== "string" || (!NUMERIC_TYPES.has(item.type) && !["File", "DeviceAddress", "sensors_event_t"].includes(item.type))) issues.push(itemPath + ".type is not supported by the simulator");
      if (typeof item.name !== "string" || !IDENTIFIER.test(item.name)) issues.push(itemPath + ".name is invalid");
      else { names.add(item.name); if (typeof item.type === "string") objectTypes.set(item.name, item.type); }
      if (item.initializer !== undefined) validateExpression(item.initializer, names, itemPath + ".initializer", issues);
      if (item.arraySize !== undefined) validateExpression(item.arraySize, names, itemPath + ".arraySize", issues);
      if (item.values !== undefined) {
        if (!Array.isArray(item.values) || item.values.length > 64) issues.push(itemPath + ".values is too large");
        else item.values.forEach((expression, valueIndex) => validateExpression(expression, names, itemPath + ".values[" + valueIndex + "]", issues));
      }
      continue;
    }
    if (item.kind === "assign") {
      if (!ASSIGNMENT_OPERATORS.has(String(item.operator))) issues.push(itemPath + ".operator is not supported");
      validateExpression(item.target, names, itemPath + ".target", issues);
      if (item.operator !== "++" && item.operator !== "--") validateExpression(item.value, names, itemPath + ".value", issues);
      continue;
    }
    if (item.kind === "call") {
      if (typeof item.callee !== "string" || !CALL_TARGET.test(item.callee) || !Array.isArray(item.arguments) || item.arguments.length > 12) { issues.push(itemPath + " has an invalid call shape"); continue; }
      item.arguments.forEach((argument, argumentIndex) => validateExpression(argument, names, itemPath + ".arguments[" + argumentIndex + "]", issues));
      validateCall(item.callee, item.arguments.length, boardId, objectTypes, helperFunctions, itemPath, issues);
      continue;
    }
    if (item.kind === "if") {
      validateExpression(item.condition, names, itemPath + ".condition", issues);
      validateStatements(item.then, names, boardId, objectTypes, helperFunctions, itemPath + ".then", issues, depth + 1, stats);
      if (item.otherwise !== undefined) validateStatements(item.otherwise, names, boardId, objectTypes, helperFunctions, itemPath + ".otherwise", issues, depth + 1, stats);
      continue;
    }
    if (item.kind === "for") {
      if (item.init !== undefined) validateStatements([item.init], names, boardId, objectTypes, helperFunctions, itemPath + ".init", issues, depth + 1, stats);
      if (item.condition !== undefined) validateExpression(item.condition, names, itemPath + ".condition", issues);
      if (item.update !== undefined) validateStatements([item.update], names, boardId, objectTypes, helperFunctions, itemPath + ".update", issues, depth + 1, stats);
      validateStatements(item.body, names, boardId, objectTypes, helperFunctions, itemPath + ".body", issues, depth + 1, stats);
      continue;
    }
    if (item.kind === "return") {
      if (item.value !== undefined) validateExpression(item.value, names, itemPath + ".value", issues);
      continue;
    }
    issues.push(itemPath + ".kind is unsupported");
  }
  return true;
}

function allPathsReturn(statements: readonly ProgramStatement[]): boolean {
  for (const statement of statements) {
    if (statement.kind === "return") return true;
    if (statement.kind === "if" && statement.otherwise && allPathsReturn(statement.then) && allPathsReturn(statement.otherwise)) return true;
  }
  return false;
}

export function validateSketchProgram(value: unknown, boardId: string): SketchProgramValidation {
  const issues: string[] = [];
  if (!isRecord(value)) return { ok: false, issues: ["program must be an object"] };
  if (!SIMULATOR_CAPABILITY_REGISTRY.boards[boardId]) return { ok: false, issues: ["program references an unsupported board profile"] };
  const rawHeaders = value.headers;
  const allowedHeaders = new Set([...Object.keys(SIMULATOR_CAPABILITY_REGISTRY.libraries), ...SIMULATOR_CAPABILITY_REGISTRY.deviceApis.filter(api => !api.boards || api.boards.includes(boardId)).map(api => api.header), ...SIMULATOR_CAPABILITY_REGISTRY.extraHeaders]);
  const headers = Array.isArray(rawHeaders) ? rawHeaders.filter((header): header is string => typeof header === "string") : [];
  if (!Array.isArray(rawHeaders) || headers.length !== rawHeaders.length || headers.length > 24) issues.push("program.headers must be an array of at most 24 supported headers");
  if (headers.some(header => !allowedHeaders.has(header))) issues.push("program.headers contains a library without a simulation adapter for " + boardId);
  if (new Set(headers).size !== headers.length) issues.push("program.headers contains duplicates");

  const rawObjects = Array.isArray(value.objects) ? value.objects : [];
  if (!Array.isArray(value.objects) || rawObjects.length > 80) issues.push("program.objects must contain at most 80 declarations");
  const rawGlobals = Array.isArray(value.globals) ? value.globals : [];
  if (!Array.isArray(value.globals) || rawGlobals.length > 100) issues.push("program.globals must contain at most 100 declarations");
  const objects: SketchProgram["objects"] = [];
  const objectTypes = new Map<string, string>();
  const constantNames = new Set([...Object.keys(SIMULATOR_CAPABILITY_REGISTRY.constants), ...Object.keys(boardApiConstants(boardId)), "HIGH", "LOW", "true", "false"]);
  const names = new Set<string>(["Serial", ...Object.keys(SINGLETON_METHODS), ...constantNames]);
  const declaredNames = new Set<string>();
  for (const raw of rawGlobals) if (isRecord(raw) && typeof raw.name === "string" && IDENTIFIER.test(raw.name)) names.add(raw.name);
  for (const [index, raw] of rawObjects.entries()) {
    const path = "program.objects[" + index + "]";
    if (!isRecord(raw) || typeof raw.type !== "string" || typeof raw.name !== "string" || !Array.isArray(raw.arguments)) { issues.push(path + " must include type, name, and arguments"); continue; }
    if (!IDENTIFIER.test(raw.name)) issues.push(path + ".name is invalid");
    if (declaredNames.has(raw.name) || Object.hasOwn(SINGLETON_METHODS, raw.name)) issues.push(path + ".name duplicates a previously declared object or global");
    const api = API_METHODS_BY_CLASS.get(raw.type)?.find(candidate => !candidate.boards || candidate.boards.includes(boardId));
    const libraryClass = Object.values(SIMULATOR_CAPABILITY_REGISTRY.libraries).some(library => "className" in library && library.className === raw.type);
    if (!api && !libraryClass && !Object.hasOwn(SIMULATOR_CAPABILITY_REGISTRY.constructorSignatures, raw.type)) issues.push(path + ".type is not a registered simulator class");
    if (api && api.boards && !api.boards.includes(boardId)) issues.push(path + ".type is not supported on " + boardId);
    if (api && !headers.includes(api.header)) issues.push(path + " must include <" + api.header + ">");
    const constructor = SIMULATOR_CAPABILITY_REGISTRY.constructorSignatures[raw.type];
    if (constructor && (raw.arguments.length < constructor[0] || raw.arguments.length > constructor[1])) issues.push(path + " constructor expects " + (constructor[0] === constructor[1] ? constructor[0] : constructor[0] + " to " + constructor[1]) + " argument(s), received " + raw.arguments.length);
    raw.arguments.forEach((argument, argumentIndex) => validateExpression(argument, names, path + ".arguments[" + argumentIndex + "]", issues));
    names.add(raw.name);
    declaredNames.add(raw.name);
    objectTypes.set(raw.name, raw.type);
    if (raw.type === "XBee") objectTypes.set(raw.name + "__response", "XBeeResponse");
    objects.push({ type: raw.type, name: raw.name, arguments: raw.arguments as ProgramExpression[] });
  }

  const globals: SketchProgram["globals"] = [];
  for (const [index, raw] of rawGlobals.entries()) {
    const path = "program.globals[" + index + "]";
    if (!isRecord(raw) || raw.kind !== "declare" || typeof raw.type !== "string" || typeof raw.name !== "string" || !IDENTIFIER.test(raw.name)) { issues.push(path + " must be a typed declaration"); continue; }
    if (!NUMERIC_TYPES.has(raw.type) && !["DeviceAddress", "sensors_event_t"].includes(raw.type) && !(raw.type === "char" && Array.isArray(raw.values))) issues.push(path + ".type is not supported for a global variable");
    if (declaredNames.has(raw.name) || Object.hasOwn(SINGLETON_METHODS, raw.name)) issues.push(path + ".name duplicates a previously declared name");
    names.add(raw.name);
    declaredNames.add(raw.name);
    if (raw.initializer !== undefined) validateExpression(raw.initializer, names, path + ".initializer", issues);
    if (raw.arraySize !== undefined) validateExpression(raw.arraySize, names, path + ".arraySize", issues);
    if (raw.values !== undefined) {
      if (!Array.isArray(raw.values) || raw.values.length > 64) issues.push(path + ".values is too large");
      else raw.values.forEach((expression, valueIndex) => validateExpression(expression, names, path + ".values[" + valueIndex + "]", issues));
    }
    globals.push({ kind: "declare", type: raw.type, name: raw.name, ...(raw.initializer !== undefined ? { initializer: raw.initializer as ProgramExpression } : {}), ...(raw.arraySize !== undefined ? { arraySize: raw.arraySize as ProgramExpression } : {}), ...(Array.isArray(raw.values) ? { values: raw.values as ProgramExpression[] } : {}), ...(raw.constant === true ? { constant: true } : {}) });
  }

  const rawFunctions = Array.isArray(value.functions) ? value.functions : [];
  if (!Array.isArray(value.functions) || rawFunctions.length < 2 || rawFunctions.length > 32) issues.push("program.functions must contain setup, loop, and up to thirty helper functions");
  const functions: SketchProgram["functions"] = [];
  const functionNames = new Set<string>();
  for (const [index, raw] of rawFunctions.entries()) {
    const path = "program.functions[" + index + "]";
    if (!isRecord(raw) || typeof raw.name !== "string" || !IDENTIFIER.test(raw.name) || typeof raw.returnType !== "string" || !Array.isArray(raw.parameters) || !Array.isArray(raw.body)) { issues.push(path + " has an invalid function shape"); continue; }
    if (functionNames.has(raw.name)) issues.push(path + ".name is duplicated");
    functionNames.add(raw.name);
    if (raw.name === "setup" || raw.name === "loop") {
      if (raw.returnType !== "void" || raw.parameters.length) issues.push(path + " " + raw.name + " must be a parameterless void function");
    } else if (raw.returnType !== "void" && !NUMERIC_TYPES.has(raw.returnType)) issues.push(path + ".returnType is unsupported");
    const parameters: SketchProgram["functions"][number]["parameters"] = [];
    for (const [parameterIndex, parameter] of raw.parameters.entries()) {
      if (!isRecord(parameter) || typeof parameter.type !== "string" || !IDENTIFIER.test(String(parameter.name)) || (!NUMERIC_TYPES.has(parameter.type) && parameter.type !== "char")) { issues.push(path + ".parameters[" + parameterIndex + "] is invalid"); continue; }
      parameters.push({ type: parameter.type, name: String(parameter.name) });
      names.add(String(parameter.name));
    }
    functions.push({ name: raw.name, returnType: raw.returnType, parameters, body: raw.body as ProgramStatement[] });
  }
  if (!functionNames.has("setup")) issues.push("program.functions is missing setup()");
  if (!functionNames.has("loop")) issues.push("program.functions is missing loop()");

  const helperFunctions = new Map<string, { parameters: number; callback: boolean }>();
  for (const fn of functions) helperFunctions.set(fn.name, { parameters: fn.parameters.length, callback: fn.returnType === "void" });
  for (const fn of functions) {
    const functionNamesInScope = new Set([...names, ...fn.parameters.map(parameter => parameter.name), ...functionNames, ...constantNames]);
    const callbacks = new Set(fn.body.flatMap(statement => statement.kind === "call" && /^(?:Wire\.)on(?:Receive|Request)$/.test(statement.callee)
      ? statement.arguments.filter((argument): argument is string => typeof argument === "string" && IDENTIFIER.test(argument))
      : []));
    if (fn.name !== "setup" && fn.name !== "loop" && fn.returnType === "void" && !callbacks.has(fn.name)) issues.push("program function " + fn.name + " must be setup(), loop(), a Wire callback, or a numeric helper");
    const helperBodiesOnlyReturnLogic = fn.name !== "setup" && fn.name !== "loop" && fn.returnType !== "void";
    if (helperBodiesOnlyReturnLogic && !fn.body.every(statement => statement.kind === "if" || statement.kind === "return")) issues.push("numeric helper " + fn.name + " may only contain if/else blocks and return expressions");
    if (helperBodiesOnlyReturnLogic && !allPathsReturn(fn.body)) issues.push("numeric helper " + fn.name + " must return a value on every path");
    validateStatements(fn.body, functionNamesInScope, boardId, new Map(objectTypes), helperFunctions, "program.functions." + fn.name + ".body", issues);
  }

  for (const object of objects) {
    const api = API_METHODS_BY_CLASS.get(object.type)?.find(candidate => !candidate.boards || candidate.boards.includes(boardId));
    if (api?.header && !headers.includes(api.header)) issues.push("program.objects." + object.name + " requires <" + api.header + ">");
  }
  if (issues.length) return { ok: false, issues: [...new Set(issues)].slice(0, 40) };
  const program: SketchProgram = { headers, objects, globals, functions };
  const code = renderSketchProgram(program);
  const compilation = compileArduinoSketch(code, boardId);
  const diagnostics = compilation.diagnostics.filter(diagnostic => diagnostic.severity === "error");
  if (diagnostics.length) return { ok: false, issues: diagnostics.slice(0, 20).map(diagnostic => "simulator " + diagnostic.code + (diagnostic.line ? " at line " + diagnostic.line : "") + ": " + diagnostic.message) };
  return { ok: true, value: { program, code, diagnostics: [...compilation.diagnostics] } };
}
