import { isUnoPin, UNO_PWM_PINS, unoPinLabel } from "./pins.ts";
import type {
  CompiledArduinoSketch,
  SimulatorDiagnostic,
  SketchInstruction,
  UnoPinMode,
} from "./types.ts";

interface FunctionBody {
  body: string;
  startIndex: number;
}

interface Statement {
  text: string;
  startIndex: number;
  nestingDepth: number;
}

function maskComments(source: string): string {
  let output = "";
  let state: "normal" | "string" | "char" | "line" | "block" = "normal";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];

    if (state === "line") {
      if (character === "\n") {
        state = "normal";
        output += "\n";
      } else {
        output += " ";
      }
      continue;
    }

    if (state === "block") {
      if (character === "*" && next === "/") {
        output += "  ";
        index += 1;
        state = "normal";
      } else {
        output += character === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (state === "string" || state === "char") {
      output += character;
      if (character === "\\" && next !== undefined) {
        output += next;
        index += 1;
      } else if (
        (state === "string" && character === '"') ||
        (state === "char" && character === "'")
      ) {
        state = "normal";
      }
      continue;
    }

    if (character === "/" && next === "/") {
      output += "  ";
      index += 1;
      state = "line";
    } else if (character === "/" && next === "*") {
      output += "  ";
      index += 1;
      state = "block";
    } else {
      output += character;
      if (character === '"') state = "string";
      if (character === "'") state = "char";
    }
  }

  return output;
}

function findClosingBrace(source: string, openingBrace: number): number | undefined {
  let depth = 0;
  let quote: '"' | "'" | undefined;

  for (let index = openingBrace; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return undefined;
}

function extractFunction(
  source: string,
  name: "setup" | "loop",
  diagnostics: SimulatorDiagnostic[],
): FunctionBody | undefined {
  const matcher = new RegExp(`\\bvoid\\s+${name}\\s*\\(\\s*\\)\\s*\\{`, "m");
  const match = matcher.exec(source);
  if (!match) return undefined;

  const openingBrace = match.index + match[0].lastIndexOf("{");
  const closingBrace = findClosingBrace(source, openingBrace);
  if (closingBrace === undefined) {
    diagnostics.push({
      severity: "error",
      code: "UNTERMINATED_FUNCTION",
      message: `The ${name}() function is missing its closing brace.`,
      line: lineAt(source, openingBrace),
    });
    return undefined;
  }

  return {
    body: source.slice(openingBrace + 1, closingBrace),
    startIndex: openingBrace + 1,
  };
}

function lineAt(source: string, index: number): number {
  let line = 1;
  for (let cursor = 0; cursor < index; cursor += 1) {
    if (source[cursor] === "\n") line += 1;
  }
  return line;
}

function scanStatements(body: FunctionBody): Statement[] {
  const statements: Statement[] = [];
  let start = 0;
  let braceDepth = 0;
  let parenthesisDepth = 0;
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < body.body.length; index += 1) {
    const character = body.body[index];
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(") {
      parenthesisDepth += 1;
    } else if (character === ")") {
      parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    } else if (character === "{") {
      braceDepth += 1;
      start = index + 1;
    } else if (character === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      start = index + 1;
    } else if (character === ";" && parenthesisDepth === 0) {
      const raw = body.body.slice(start, index + 1);
      const leadingWhitespace = raw.search(/\S/);
      if (leadingWhitespace >= 0) {
        statements.push({
          text: raw.trim(),
          startIndex: body.startIndex + start + leadingWhitespace,
          nestingDepth: braceDepth,
        });
      }
      start = index + 1;
    }
  }

  return statements;
}

function splitArguments(input: string): string[] | undefined {
  if (input.trim() === "") return [];

  const argumentsList: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: '"' | "'" | undefined;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote) {
      if (character === "\\") {
        index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(") {
      depth += 1;
    } else if (character === ")") {
      depth -= 1;
      if (depth < 0) return undefined;
    } else if (character === "," && depth === 0) {
      argumentsList.push(input.slice(start, index).trim());
      start = index + 1;
    }
  }

  if (quote || depth !== 0) return undefined;
  argumentsList.push(input.slice(start).trim());
  return argumentsList;
}

interface ExpressionToken {
  type: "number" | "identifier" | "operator";
  value: string;
}

function tokenizeExpression(expression: string): ExpressionToken[] | undefined {
  const tokens: ExpressionToken[] = [];
  let index = 0;

  while (index < expression.length) {
    const remainder = expression.slice(index);
    const whitespace = /^\s+/.exec(remainder);
    if (whitespace) {
      index += whitespace[0].length;
      continue;
    }

    const hex = /^0[xX][0-9a-fA-F]+[uUlL]*/.exec(remainder);
    if (hex) {
      tokens.push({ type: "number", value: hex[0].replace(/[uUlL]+$/, "") });
      index += hex[0].length;
      continue;
    }

    const number = /^\d+(?:\.\d+)?[uUlL]*/.exec(remainder);
    if (number) {
      tokens.push({ type: "number", value: number[0].replace(/[uUlL]+$/, "") });
      index += number[0].length;
      continue;
    }

    const identifier = /^[A-Za-z_]\w*/.exec(remainder);
    if (identifier) {
      tokens.push({ type: "identifier", value: identifier[0] });
      index += identifier[0].length;
      continue;
    }

    const operator = /^(?:&&|\|\||==|!=|<=|>=|[+\-*/%()!,:?<>])/.exec(remainder);
    if (operator) {
      tokens.push({ type: "operator", value: operator[0] });
      index += operator[0].length;
      continue;
    }

    return undefined;
  }

  return tokens;
}

class ExpressionParser {
  private cursor = 0;

  constructor(
    private readonly tokens: ExpressionToken[],
    private readonly constants: ReadonlyMap<string, number>,
    private readonly functions: Readonly<Record<string, (...args: number[]) => number>> = {},
  ) {}

  parse(): number | undefined {
    const value = this.parseConditional();
    return value !== undefined && this.cursor === this.tokens.length
      ? value
      : undefined;
  }

  private parseConditional(): number | undefined {
    const condition = this.parseLogicalOr();
    if (condition === undefined || !this.peek("?")) return condition;
    this.cursor += 1;
    const whenTrue = this.parseConditional();
    if (whenTrue === undefined || !this.peek(":")) return undefined;
    this.cursor += 1;
    const whenFalse = this.parseConditional();
    if (whenFalse === undefined) return undefined;
    return condition !== 0 ? whenTrue : whenFalse;
  }

  private parseLogicalOr(): number | undefined {
    let value = this.parseLogicalAnd();
    while (value !== undefined && this.peek("||")) {
      this.cursor += 1;
      const right = this.parseLogicalAnd();
      if (right === undefined) return undefined;
      value = value !== 0 || right !== 0 ? 1 : 0;
    }
    return value;
  }

  private parseLogicalAnd(): number | undefined {
    let value = this.parseEquality();
    while (value !== undefined && this.peek("&&")) {
      this.cursor += 1;
      const right = this.parseEquality();
      if (right === undefined) return undefined;
      value = value !== 0 && right !== 0 ? 1 : 0;
    }
    return value;
  }

  private parseEquality(): number | undefined {
    let value = this.parseComparison();
    while (value !== undefined && (this.peek("==") || this.peek("!="))) {
      const operator = this.tokens[this.cursor++].value;
      const right = this.parseComparison();
      if (right === undefined) return undefined;
      value = operator === "==" ? Number(value === right) : Number(value !== right);
    }
    return value;
  }

  private parseComparison(): number | undefined {
    let value = this.parseAdditive();
    while (value !== undefined && ["<", "<=", ">", ">="].some((item) => this.peek(item))) {
      const operator = this.tokens[this.cursor++].value;
      const right = this.parseAdditive();
      if (right === undefined) return undefined;
      value = Number(operator === "<" ? value < right : operator === "<=" ? value <= right : operator === ">" ? value > right : value >= right);
    }
    return value;
  }

  private parseAdditive(): number | undefined {
    let value = this.parseMultiplicative();
    if (value === undefined) return undefined;

    while (this.peek("+") || this.peek("-")) {
      const operator = this.tokens[this.cursor].value;
      this.cursor += 1;
      const right = this.parseMultiplicative();
      if (right === undefined) return undefined;
      value = operator === "+" ? value + right : value - right;
    }

    return value;
  }

  private parseMultiplicative(): number | undefined {
    let value = this.parseUnary();
    if (value === undefined) return undefined;

    while (this.peek("*") || this.peek("/") || this.peek("%")) {
      const operator = this.tokens[this.cursor].value;
      this.cursor += 1;
      const right = this.parseUnary();
      if (right === undefined || ((operator === "/" || operator === "%") && right === 0)) {
        return undefined;
      }
      if (operator === "*") value *= right;
      if (operator === "/") value /= right;
      if (operator === "%") value %= right;
    }

    return value;
  }

  private parseUnary(): number | undefined {
    if (this.peek("+") || this.peek("-") || this.peek("!")) {
      const operator = this.tokens[this.cursor].value;
      this.cursor += 1;
      const value = this.parseUnary();
      if (value === undefined) return undefined;
      return operator === "-" ? -value : operator === "!" ? Number(value === 0) : value;
    }
    return this.parsePrimary();
  }

  private parsePrimary(): number | undefined {
    const token = this.tokens[this.cursor];
    if (!token) return undefined;

    if (token.type === "number") {
      this.cursor += 1;
      return Number(token.value);
    }

    if (token.type === "identifier") {
      this.cursor += 1;
      if (this.peek("(")) {
        this.cursor += 1;
        const args: number[] = [];
        if (!this.peek(")")) {
          while (true) {
            const argument = this.parseConditional();
            if (argument === undefined) return undefined;
            args.push(argument);
            if (!this.peek(",")) break;
            this.cursor += 1;
          }
        }
        if (!this.peek(")")) return undefined;
        this.cursor += 1;
        return this.functions[token.value]?.(...args);
      }
      return this.constants.get(token.value);
    }

    if (token.value === "(") {
      this.cursor += 1;
      const value = this.parseConditional();
      if (value === undefined || !this.peek(")")) return undefined;
      this.cursor += 1;
      return value;
    }

    return undefined;
  }

  private peek(operator: string): boolean {
    return this.tokens[this.cursor]?.value === operator;
  }
}

export function evaluateRuntimeExpression(
  expression: string,
  variables: ReadonlyMap<string, number>,
  functions: Readonly<Record<string, (...args: number[]) => number>> = {},
): number | undefined {
  const tokens = tokenizeExpression(expression.trim());
  if (!tokens) return undefined;
  const result = new ExpressionParser(tokens, variables, functions).parse();
  return result !== undefined && Number.isFinite(result) ? result : undefined;
}

function evaluateStatic(
  expression: string,
  constants: ReadonlyMap<string, number>,
): number | undefined {
  const tokens = tokenizeExpression(expression.trim());
  if (!tokens) return undefined;
  const result = new ExpressionParser(tokens, constants).parse();
  return result !== undefined && Number.isFinite(result) ? result : undefined;
}

function defaultConstants(): Map<string, number> {
  const constants = new Map<string, number>([
    ["LOW", 0],
    ["HIGH", 1],
    ["false", 0],
    ["true", 1],
    ["LED_BUILTIN", 13],
  ]);
  for (let analog = 0; analog < 6; analog += 1) {
    constants.set(`A${analog}`, 14 + analog);
  }
  return constants;
}

function collectConstants(source: string): Map<string, number> {
  const constants = defaultConstants();
  const pending: Array<[string, string]> = [];

  for (const match of source.matchAll(/^\s*#define\s+([A-Za-z_]\w*)\s+([^\r\n]+)/gm)) {
    pending.push([match[1], match[2].trim()]);
  }

  const declaration = /\b(?:const\s+)?(?:unsigned\s+)?(?:int|long|short|byte|uint8_t|uint16_t|size_t)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g;
  for (const match of source.matchAll(declaration)) {
    pending.push([match[1], match[2].trim()]);
  }

  let changed = true;
  while (changed && pending.length > 0) {
    changed = false;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const [name, expression] = pending[index];
      const value = evaluateStatic(expression, constants);
      if (value !== undefined) {
        constants.set(name, value);
        pending.splice(index, 1);
        changed = true;
      }
    }
  }

  return constants;
}

function decodeStringLiteral(value: string): string | undefined {
  const quote = value[0];
  if ((quote !== '"' && quote !== "'") || value[value.length - 1] !== quote) {
    return undefined;
  }

  let result = "";
  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index];
    if (character !== "\\") {
      result += character;
      continue;
    }

    index += 1;
    const escaped = value[index];
    if (escaped === undefined) return undefined;
    const replacements: Record<string, string> = {
      n: "\n",
      r: "\r",
      t: "\t",
      "0": "\0",
      "\\": "\\",
      '"': '"',
      "'": "'",
    };
    result += replacements[escaped] ?? escaped;
  }
  return result;
}

function printValue(
  expression: string,
  constants: ReadonlyMap<string, number>,
): string | undefined {
  const trimmed = expression.trim();
  if (trimmed === "") return "";
  const string = decodeStringLiteral(trimmed);
  if (string !== undefined) return string;
  const number = evaluateStatic(trimmed, constants);
  return number === undefined ? undefined : String(number);
}

function addArgumentError(
  diagnostics: SimulatorDiagnostic[],
  line: number,
  call: string,
  expected: string,
): void {
  diagnostics.push({
    severity: "error",
    code: "INVALID_ARGUMENTS",
    message: `${call} expects ${expected}.`,
    line,
  });
}

function compileBody(
  source: string,
  body: FunctionBody | undefined,
  constants: ReadonlyMap<string, number>,
  diagnostics: SimulatorDiagnostic[],
): SketchInstruction[] {
  if (!body) return [];

  const instructions: SketchInstruction[] = [];
  const controlFlow = /\b(if|else|for|while|switch|do)\b/.exec(body.body);
  if (controlFlow) {
    diagnostics.push({
      severity: "warning",
      code: "UNSUPPORTED_CONTROL_FLOW",
      message:
        "Conditional and loop statements are not simulated yet; calls nested inside them were skipped.",
      line: lineAt(source, body.startIndex + controlFlow.index),
    });
  }

  for (const statement of scanStatements(body)) {
    const line = lineAt(source, statement.startIndex);
    if (statement.nestingDepth > 0) continue;

    if (/^(?:const\s+)?(?:unsigned\s+)?(?:int|long|short|byte|uint8_t|uint16_t|size_t)\b/.test(statement.text)) {
      continue;
    }

    const call = /^([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)?)\s*\(([\s\S]*)\)\s*;$/.exec(
      statement.text,
    );
    if (!call) {
      diagnostics.push({
        severity: "error",
        code: "UNSUPPORTED_STATEMENT",
        message: `This statement is outside the simulator subset and was skipped: ${statement.text}`,
        line,
      });
      continue;
    }

    const callee = call[1].replace(/\s/g, "");
    const args = splitArguments(call[2]);
    if (!args) {
      addArgumentError(diagnostics, line, callee, "well-formed arguments");
      continue;
    }

    const sourceInfo = { line, source: statement.text };
    if (callee === "Serial.begin") continue;

    if (callee === "pinMode") {
      if (args.length !== 2) {
        addArgumentError(diagnostics, line, callee, "a pin and a mode");
        continue;
      }
      const pin = evaluateStatic(args[0], constants);
      const rawMode = args[1].trim();
      const mode: UnoPinMode | undefined =
        rawMode === "INPUT" || rawMode === "OUTPUT" || rawMode === "INPUT_PULLUP"
          ? rawMode
          : undefined;
      if (pin === undefined || !isUnoPin(pin) || !mode) {
        diagnostics.push({
          severity: "error",
          code: "INVALID_PIN_MODE",
          message: `${callee} requires a valid Uno pin and INPUT, OUTPUT, or INPUT_PULLUP.`,
          line,
        });
        continue;
      }
      instructions.push({ kind: "pinMode", pin, mode, ...sourceInfo });
      continue;
    }

    if (callee === "digitalWrite") {
      if (args.length !== 2) {
        addArgumentError(diagnostics, line, callee, "a pin and HIGH or LOW");
        continue;
      }
      const pin = evaluateStatic(args[0], constants);
      const value = evaluateStatic(args[1], constants);
      if (pin === undefined || !isUnoPin(pin)) {
        diagnostics.push({
          severity: "error",
          code: "INVALID_DIGITAL_WRITE",
          message: `${callee} requires a valid Uno pin and HIGH/LOW (or 1/0).`,
          line,
        });
        continue;
      }
      if (value === undefined) {
        instructions.push({ kind: "digitalWriteExpression", pin, expression: args[1].trim(), ...sourceInfo });
        continue;
      }
      if (value !== 0 && value !== 1) {
        diagnostics.push({
          severity: "error",
          code: "INVALID_DIGITAL_WRITE",
          message: `${callee} requires HIGH/LOW, 1/0, or a numeric state expression.`,
          line,
        });
        continue;
      }
      instructions.push({ kind: "digitalWrite", pin, value, ...sourceInfo });
      continue;
    }

    if (callee === "analogWrite") {
      if (args.length !== 2) {
        addArgumentError(diagnostics, line, callee, "a PWM pin and a value from 0 to 255");
        continue;
      }
      const pin = evaluateStatic(args[0], constants);
      const rawValue = evaluateStatic(args[1], constants);
      if (pin === undefined || !isUnoPin(pin) || rawValue === undefined) {
        diagnostics.push({
          severity: "error",
          code: "INVALID_ANALOG_WRITE",
          message: `${callee} requires a valid Uno pin and a static numeric value.`,
          line,
        });
        continue;
      }
      if (!UNO_PWM_PINS.has(pin)) {
        diagnostics.push({
          severity: "warning",
          code: "NON_PWM_PIN",
          message: `${unoPinLabel(pin)} is not a PWM-capable Arduino Uno pin.`,
          line,
        });
      }
      const value = Math.round(Math.min(255, Math.max(0, rawValue)));
      if (value !== rawValue) {
        diagnostics.push({
          severity: "warning",
          code: "PWM_VALUE_CLAMPED",
          message: `analogWrite value ${rawValue} was clamped to ${value}.`,
          line,
        });
      }
      instructions.push({ kind: "analogWrite", pin, value, ...sourceInfo });
      continue;
    }

    if (callee === "delay") {
      const duration = args.length === 1 ? evaluateStatic(args[0], constants) : undefined;
      if (duration === undefined || duration < 0) {
        addArgumentError(diagnostics, line, callee, "one non-negative static duration");
        continue;
      }
      instructions.push({
        kind: "delay",
        durationMs: Math.round(duration),
        ...sourceInfo,
      });
      continue;
    }

    if (callee === "Serial.println" || callee === "Serial.print") {
      const value = args.length <= 1 ? printValue(args[0] ?? "", constants) : undefined;
      if (value === undefined) {
        diagnostics.push({
          severity: "warning",
          code: "DYNAMIC_SERIAL_VALUE",
          message: `${callee} currently supports strings, characters, and static numeric expressions.`,
          line,
        });
        continue;
      }
      instructions.push({
        kind: "serialPrint",
        value,
        newline: callee === "Serial.println",
        ...sourceInfo,
      });
      continue;
    }

    diagnostics.push({
      severity: "error",
      code: "UNSUPPORTED_CALL",
      message: `${callee}() is outside the simulator subset and was skipped.`,
      line,
    });
  }

  return instructions;
}

function compileExecutableBody(
  source: string,
  body: FunctionBody | undefined,
  constants: ReadonlyMap<string, number>,
  diagnostics: SimulatorDiagnostic[],
): SketchInstruction[] {
  if (!body) return [];
  const instructions: SketchInstruction[] = [];
  const text = body.body;

  const skipWhitespace = (start: number) => {
    let cursor = start;
    while (/\s/.test(text[cursor] ?? "")) cursor += 1;
    return cursor;
  };
  const matching = (start: number, open: string, close: string): number | undefined => {
    let depth = 0;
    for (let cursor = start; cursor < text.length; cursor += 1) {
      if (text[cursor] === open) depth += 1;
      if (text[cursor] === close && --depth === 0) return cursor;
    }
    return undefined;
  };
  const conditionalEnd = (start: number): number | undefined => {
    if (!/^if\b/.test(text.slice(start))) return undefined;
    const openParen = skipWhitespace(start + 2);
    if (text[openParen] !== "(") return undefined;
    const closeParen = matching(openParen, "(", ")");
    if (closeParen === undefined) return undefined;
    const openBrace = skipWhitespace(closeParen + 1);
    if (text[openBrace] !== "{") return undefined;
    const closeBrace = matching(openBrace, "{", "}");
    if (closeBrace === undefined) return undefined;
    const afterThen = skipWhitespace(closeBrace + 1);
    if (!/^else\b/.test(text.slice(afterThen))) return closeBrace + 1;
    const elseStart = skipWhitespace(afterThen + 4);
    if (/^if\b/.test(text.slice(elseStart))) return conditionalEnd(elseStart);
    if (text[elseStart] !== "{") return elseStart;
    const elseClose = matching(elseStart, "{", "}");
    return elseClose === undefined ? undefined : elseClose + 1;
  };
  const compileSimple = (statement: string, localStart: number) => {
    const trimmed = statement.trim();
    const sourceInfo = { line: lineAt(source, body.startIndex + localStart), source: trimmed };
    const declaration = /^(?:(?:const\s+)?(?:unsigned\s+)?(?:int|long|short|byte|uint8_t|uint16_t|size_t|bool|float|double))\s+([A-Za-z_]\w*)(?:\s*=\s*([^;]+))?\s*;$/.exec(trimmed);
    if (declaration) {
      instructions.push({ kind: "declare", name: declaration[1], expression: declaration[2]?.trim() ?? "0", ...sourceInfo });
      return;
    }
    const assignment = /^([A-Za-z_]\w*)\s*(=|\+=|-=|\*=|\/=|%=)\s*([^;]+)\s*;$/.exec(trimmed);
    if (assignment) {
      const expression = assignment[2] === "=" ? assignment[3] : `${assignment[1]} ${assignment[2][0]} (${assignment[3]})`;
      instructions.push({ kind: "assign", name: assignment[1], expression, ...sourceInfo });
      return;
    }
    const increment = /^(?:([A-Za-z_]\w*)\+\+|\+\+([A-Za-z_]\w*)|([A-Za-z_]\w*)--|--([A-Za-z_]\w*))\s*;$/.exec(trimmed);
    if (increment) {
      const name = increment[1] ?? increment[2] ?? increment[3] ?? increment[4];
      const delta = increment[1] || increment[2] ? 1 : -1;
      instructions.push({ kind: "assign", name, expression: `${name} ${delta > 0 ? "+" : "-"} 1`, ...sourceInfo });
      return;
    }
    const methodCall = /^([A-Za-z_]\w*)\.([A-Za-z_]\w*)\s*\(([\s\S]*)\)\s*;$/.exec(trimmed);
    if (methodCall) {
      const [, instance, method, rawArgs] = methodCall;
      const args = splitArguments(rawArgs);
      if (!args) {
        addArgumentError(diagnostics, sourceInfo.line, `${instance}.${method}`, "well-formed arguments");
        return;
      }
      if (instance === "Serial" && method === "begin") return;
      if (instance === "Serial" && (method === "print" || method === "println") && args.length >= 1) {
        const value = printValue(args[0], constants);
        if (value !== undefined) instructions.push({ kind: "serialPrint", value, newline: method === "println", ...sourceInfo });
        else diagnostics.push({ severity: "warning", code: "DYNAMIC_SERIAL_VALUE", message: `Serial.${method} currently supports strings and static numeric expressions.`, line: sourceInfo.line });
      }
      else if (method === "attach" && args.length === 1) instructions.push({ kind: "servoAttach", instance, expression: args[0], ...sourceInfo });
      else if (method === "write" && args.length === 1) instructions.push({ kind: "servoWrite", instance, expression: args[0], ...sourceInfo });
      else if (method === "begin" && args.length === 2) instructions.push({ kind: "lcdBegin", instance, columns: args[0], rows: args[1], ...sourceInfo });
      else if (method === "clear" && args.length === 0) instructions.push({ kind: "lcdClear", instance, ...sourceInfo });
      else if (method === "setCursor" && args.length === 2) instructions.push({ kind: "lcdCursor", instance, column: args[0], row: args[1], ...sourceInfo });
      else if ((method === "print" || method === "println") && args.length >= 1) instructions.push({ kind: "lcdPrint", instance, expression: args[0], newline: method === "println", ...sourceInfo });
      else diagnostics.push({ severity: "error", code: "UNSUPPORTED_CALL", message: `${instance}.${method}() is outside the simulator subset.`, line: sourceInfo.line });
      return;
    }
    const toneCall = /^(tone|noTone)\s*\(([\s\S]*)\)\s*;$/.exec(trimmed);
    if (toneCall) {
      const args = splitArguments(toneCall[2]);
      if (args && ((toneCall[1] === "tone" && args.length >= 2) || (toneCall[1] === "noTone" && args.length === 1))) {
        instructions.push({ kind: "tone", pinExpression: args[0], ...(toneCall[1] === "tone" ? { frequencyExpression: args[1] } : {}), ...sourceInfo });
      } else addArgumentError(diagnostics, sourceInfo.line, toneCall[1], toneCall[1] === "tone" ? "a pin and frequency" : "a pin");
      return;
    }
    const compiled = compileBody(source, { body: trimmed, startIndex: body.startIndex + localStart }, constants, diagnostics);
    instructions.push(...compiled);
  };

  const compileRange = (rangeStart: number, rangeEnd: number) => {
    let cursor = rangeStart;
    while ((cursor = skipWhitespace(cursor)) < rangeEnd) {
      if (/^(?:while|for)\b/.test(text.slice(cursor))) {
        const isFor = /^for\b/.test(text.slice(cursor));
        const keywordLength = isFor ? 3 : 5;
        const openParen = skipWhitespace(cursor + keywordLength);
        if (text[openParen] !== "(") break;
        const closeParen = matching(openParen, "(", ")");
        if (closeParen === undefined) break;
        const openBrace = skipWhitespace(closeParen + 1);
        if (text[openBrace] !== "{") break;
        const closeBrace = matching(openBrace, "{", "}");
        if (closeBrace === undefined) break;
        let condition = text.slice(openParen + 1, closeParen).trim();
        let increment = "";
        if (isFor) {
          const clauses = splitArguments(condition.replace(/;/g, ","));
          if (!clauses || clauses.length !== 3) {
            diagnostics.push({ severity: "error", code: "INVALID_FOR_LOOP", message: "for loops require initializer, condition, and increment clauses.", line: lineAt(source, body.startIndex + cursor) });
            break;
          }
          if (clauses[0]) compileSimple(`${clauses[0]};`, cursor);
          condition = clauses[1] || "1";
          increment = clauses[2];
        }
        const loopStart = instructions.length;
        const jumpIfIndex = instructions.length;
        instructions.push({ kind: "jumpIfFalse", expression: condition, target: 0, line: lineAt(source, body.startIndex + cursor), source: `${isFor ? "for" : "while"} (${condition})` });
        compileRange(openBrace + 1, closeBrace);
        if (increment) compileSimple(`${increment};`, closeBrace);
        instructions.push({ kind: "jump", target: loopStart, line: lineAt(source, body.startIndex + closeBrace), source: "loop" });
        (instructions[jumpIfIndex] as Extract<SketchInstruction, { kind: "jumpIfFalse" }>).target = instructions.length;
        cursor = closeBrace + 1;
        continue;
      }
      if (/^if\b/.test(text.slice(cursor))) {
        const openParen = skipWhitespace(cursor + 2);
        if (text[openParen] !== "(") break;
        const closeParen = matching(openParen, "(", ")");
        if (closeParen === undefined) break;
        const openBrace = skipWhitespace(closeParen + 1);
        if (text[openBrace] !== "{") break;
        const closeBrace = matching(openBrace, "{", "}");
        if (closeBrace === undefined) break;
        const condition = text.slice(openParen + 1, closeParen).trim();
        const jumpIfIndex = instructions.length;
        instructions.push({ kind: "jumpIfFalse", expression: condition, target: 0, line: lineAt(source, body.startIndex + cursor), source: `if (${condition})` });
        compileRange(openBrace + 1, closeBrace);
        let next = skipWhitespace(closeBrace + 1);
        if (/^else\b/.test(text.slice(next))) {
          const jumpIndex = instructions.length;
          instructions.push({ kind: "jump", target: 0, line: lineAt(source, body.startIndex + next), source: "else" });
          (instructions[jumpIfIndex] as Extract<SketchInstruction, { kind: "jumpIfFalse" }>).target = instructions.length;
          const elseBrace = skipWhitespace(next + 4);
          if (text[elseBrace] === "{") {
            const elseClose = matching(elseBrace, "{", "}");
            if (elseClose === undefined) break;
            compileRange(elseBrace + 1, elseClose);
            next = elseClose + 1;
          } else if (/^if\b/.test(text.slice(elseBrace))) {
            const elseIfEnd = conditionalEnd(elseBrace);
            if (elseIfEnd === undefined) break;
            compileRange(elseBrace, elseIfEnd);
            next = elseIfEnd;
          }
          (instructions[jumpIndex] as Extract<SketchInstruction, { kind: "jump" }>).target = instructions.length;
        } else {
          (instructions[jumpIfIndex] as Extract<SketchInstruction, { kind: "jumpIfFalse" }>).target = instructions.length;
        }
        cursor = next;
        continue;
      }
      const semicolon = text.indexOf(";", cursor);
      if (semicolon < 0 || semicolon >= rangeEnd) break;
      compileSimple(text.slice(cursor, semicolon + 1), cursor);
      cursor = semicolon + 1;
    }
  };
  compileRange(0, text.length);
  return instructions;
}

function collectGlobalVariables(source: string): Record<string, number> {
  const globals: Record<string, number> = {};
  const setupIndex = source.search(/\bvoid\s+setup\s*\(/);
  const prefix = setupIndex >= 0 ? source.slice(0, setupIndex) : source;
  const constants = defaultConstants();
  for (const match of prefix.matchAll(/\b(?:unsigned\s+)?(?:int|long|short|byte|uint8_t|uint16_t|size_t|bool|float|double)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g)) {
    const value = evaluateStatic(match[2], new Map([...constants, ...Object.entries(globals)]));
    if (value !== undefined) globals[match[1]] = value;
  }
  return globals;
}

/**
 * Compiles a deliberately small, deterministic Arduino C++ subset for the
 * browser simulator. Unsupported statements produce diagnostics rather than
 * executing arbitrary JavaScript.
 */
export function compileArduinoSketch(source: string): CompiledArduinoSketch {
  const diagnostics: SimulatorDiagnostic[] = [];
  const masked = maskComments(source);
  const constants = collectConstants(masked);
  const setupBody = extractFunction(masked, "setup", diagnostics);
  const loopBody = extractFunction(masked, "loop", diagnostics);

  if (!loopBody) {
    diagnostics.push({
      severity: "warning",
      code: "MISSING_LOOP",
      message: "No loop() function was found; the simulation will finish after setup().",
    });
  }

  const setup = compileExecutableBody(masked, setupBody, constants, diagnostics);
  const loop = compileExecutableBody(masked, loopBody, constants, diagnostics);

  return {
    source,
    setup,
    loop,
    globals: collectGlobalVariables(masked),
    diagnostics,
    valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
  };
}
