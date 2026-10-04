import { deviceInstances, DEVICE_CONSTANTS } from "./device-api.ts";
import { boardApiConstants, boardPinLabel, getBoardProfile, isBoardDigitalOutputPin, isBoardDigitalPin, isBoardPwmPin } from "../circuit/boards.ts";
import { validateLibraryCalls } from "./libraries.ts";
import type {
  CompiledArduinoSketch,
  SketchHelperFunction,
  SketchHelperStatement,
  SimulatorDiagnostic,
  SketchInstruction,
  UnoPinMode,
} from "./types.ts";

interface FunctionBody {
  body: string;
  startIndex: number;
  parameters?: string[];
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
  name: string,
  diagnostics: SimulatorDiagnostic[],
): FunctionBody | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(`\\bvoid\\s+${escapedName}\\s*\\(([^)]*)\\)\\s*\\{`, "m");
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
    parameters: (match[1] ?? "").split(",").map(parameter => parameter.trim().split(/\s+/).at(-1) ?? "").filter(parameter => /^[A-Za-z_]\w*$/.test(parameter)),
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

    const character = /^'(?:\\.|[^'\\])'/.exec(remainder);
    if (character) {
      const decoded = decodeStringLiteral(character[0]);
      if (decoded === undefined || decoded.length !== 1) return undefined;
      tokens.push({ type: "number", value: String(decoded.charCodeAt(0)) });
      index += character[0].length;
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

    // C++ libraries commonly expose enum values as Class::VALUE. Treat a
    // qualified constant as one identifier so the simulator can resolve its
    // known value instead of silently turning device commands into NaN.
    const identifier = /^[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*/.exec(remainder);
    if (identifier) {
      tokens.push({ type: "identifier", value: identifier[0] });
      index += identifier[0].length;
      continue;
    }

    const operator = /^(?:&&|\|\||<<|>>|==|!=|<=|>=|[+\-*/%()!,:?<>|&^])/.exec(remainder);
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
    private readonly integerDivision = false,
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
    let value = this.parseBitwiseOr();
    while (value !== undefined && this.peek("&&")) {
      this.cursor += 1;
      const right = this.parseBitwiseOr();
      if (right === undefined) return undefined;
      value = value !== 0 && right !== 0 ? 1 : 0;
    }
    return value;
  }

  private parseBitwiseOr(): number | undefined {
    let value = this.parseBitwiseXor();
    while (value !== undefined && this.peek("|")) {
      this.cursor += 1; const right = this.parseBitwiseXor();
      if (right === undefined) return undefined; value = Math.trunc(value) | Math.trunc(right);
    }
    return value;
  }

  private parseBitwiseXor(): number | undefined {
    let value = this.parseBitwiseAnd();
    while (value !== undefined && this.peek("^")) {
      this.cursor += 1; const right = this.parseBitwiseAnd();
      if (right === undefined) return undefined; value = Math.trunc(value) ^ Math.trunc(right);
    }
    return value;
  }

  private parseBitwiseAnd(): number | undefined {
    let value = this.parseEquality();
    while (value !== undefined && this.peek("&")) {
      this.cursor += 1; const right = this.parseEquality();
      if (right === undefined) return undefined; value = Math.trunc(value) & Math.trunc(right);
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
    let value = this.parseShift();
    while (value !== undefined && ["<", "<=", ">", ">="].some((item) => this.peek(item))) {
      const operator = this.tokens[this.cursor++].value;
      const right = this.parseShift();
      if (right === undefined) return undefined;
      value = Number(operator === "<" ? value < right : operator === "<=" ? value <= right : operator === ">" ? value > right : value >= right);
    }
    return value;
  }

  private parseShift(): number | undefined {
    let value = this.parseAdditive();
    while (value !== undefined && (this.peek("<<") || this.peek(">>"))) {
      const operator = this.tokens[this.cursor++].value;
      const right = this.parseAdditive();
      if (right === undefined) return undefined;
      const amount = Math.max(0, Math.min(31, Math.trunc(right)));
      value = operator === "<<" ? Math.trunc(value) << amount : Math.trunc(value) >> amount;
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
      if (operator === "/") value = this.integerDivision && Number.isInteger(value) && Number.isInteger(right)
        ? Math.trunc(value / right)
        : value / right;
      if (operator === "%") value %= right;
    }

    return value;
  }

  private parseUnary(): number | undefined {
    const cast = this.castTypeAhead();
    if (cast) {
      this.cursor = cast.end;
      const value = this.parseUnary();
      if (value === undefined) return undefined;
      if (cast.type === "bool") return Number(value !== 0);
      if (cast.type === "float" || cast.type === "double") return value;

      const fixedWidth = /^(u?int)(8|16|32|64)_t$/.exec(cast.type);
      const byteWidth = cast.type === "byte" ? 8 : undefined;
      const width = fixedWidth ? Number(fixedWidth[2]) : byteWidth;
      if (width) {
        const modulus = 2 ** width;
        const integer = Math.trunc(value);
        const unsigned = cast.type.startsWith("u") || cast.type === "byte";
        const wrapped = ((integer % modulus) + modulus) % modulus;
        return unsigned || wrapped < modulus / 2 ? wrapped : wrapped - modulus;
      }
      return Math.trunc(value);
    }

    if (this.peek("+") || this.peek("-") || this.peek("!")) {
      const operator = this.tokens[this.cursor].value;
      this.cursor += 1;
      const value = this.parseUnary();
      if (value === undefined) return undefined;
      return operator === "-" ? -value : operator === "!" ? Number(value === 0) : value;
    }
    return this.parsePrimary();
  }

  private castTypeAhead(): { type: string; end: number } | undefined {
    if (!this.peek("(")) return undefined;
    let end = this.cursor + 1;
    const names: string[] = [];
    while (this.tokens[end]?.type === "identifier" && names.length < 4) {
      names.push(this.tokens[end].value);
      end += 1;
    }
    if (this.tokens[end]?.value !== ")" || names.length === 0) return undefined;

    const type = names.join(" ");
    const supported = /^(?:(?:unsigned|signed)\s+)?(?:char|short(?: int)?|int|long(?: long)?(?: int)?|byte|bool|float|double|size_t|u?int(?:8|16|32|64)_t)$/;
    return supported.test(type) ? { type, end: end + 1 } : undefined;
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
      const direct = this.constants.get(token.value);
      if (direct !== undefined) return direct;
      const scope = token.value.lastIndexOf("::");
      return scope >= 0 ? this.constants.get(token.value.slice(scope + 2)) : undefined;
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
  integerDivision = false,
): number | undefined {
  const tokens = tokenizeExpression(expression.trim());
  if (!tokens) return undefined;
  const result = new ExpressionParser(tokens, variables, functions, integerDivision).parse();
  // Failed sensor reads must overwrite the previous reading with NaN so
  // sketches can detect them with isnan() and stop actuators safely.
  return result !== undefined && (Number.isFinite(result) || Number.isNaN(result)) ? result : undefined;
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

function defaultConstants(boardId = "arduino-uno"): Map<string, number> {
  const constants = new Map<string, number>([
    ["LOW", 0],
    ["HIGH", 1],
    ["false", 0],
    ["true", 1],
    ["LED_BUILTIN", 13],
  ]);
  Object.entries(boardApiConstants(boardId)).forEach(([name, value]) => constants.set(name, value));
  return constants;
}

function matchingDelimiter(source: string, opening: number, open: string, close: string): number | undefined {
  let depth = 0;
  let quote = "";
  for (let index = opening; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === "\\") index += 1;
      else if (character === quote) quote = "";
    } else if (character === "\"" || character === "'") quote = character;
    else if (character === open) depth += 1;
    else if (character === close && --depth === 0) return index;
  }
  return undefined;
}

function parseHelperBody(body: string): SketchHelperStatement[] | undefined {
  let cursor = 0;
  const skip = () => { while (/\s/.test(body[cursor] ?? "")) cursor += 1; };
  const parseStatement = (): SketchHelperStatement[] | undefined => {
    skip();
    if (body[cursor] === "{") {
      const closing = matchingDelimiter(body, cursor, "{", "}");
      if (closing === undefined) return undefined;
      const nested = parseHelperBody(body.slice(cursor + 1, closing));
      cursor = closing + 1;
      return nested;
    }
    const ifMatch = /^if\s*\(/.exec(body.slice(cursor));
    if (ifMatch) {
      const open = cursor + ifMatch[0].lastIndexOf("(");
      const closing = matchingDelimiter(body, open, "(", ")");
      if (closing === undefined) return undefined;
      const condition = body.slice(open + 1, closing).trim();
      cursor = closing + 1;
      const then = parseStatement();
      if (!then) return undefined;
      skip();
      let otherwise: SketchHelperStatement[] = [];
      if (/^else\b/.test(body.slice(cursor))) {
        cursor += 4;
        const parsedElse = parseStatement();
        if (!parsedElse) return undefined;
        otherwise = parsedElse;
      }
      return [{ kind: "if", condition, then, otherwise }];
    }
    const returnMatch = /^return\b/.exec(body.slice(cursor));
    if (!returnMatch) return undefined;
    cursor += returnMatch[0].length;
    const start = cursor;
    let parens = 0;
    let quote = "";
    for (; cursor < body.length; cursor += 1) {
      const character = body[cursor];
      if (quote) {
        if (character === "\\") cursor += 1;
        else if (character === quote) quote = "";
      } else if (character === "\"" || character === "'") quote = character;
      else if (character === "(") parens += 1;
      else if (character === ")") parens -= 1;
      else if (character === ";" && parens === 0) {
        const expression = body.slice(start, cursor).trim();
        cursor += 1;
        return expression ? [{ kind: "return", expression }] : undefined;
      }
    }
    return undefined;
  };

  const statements: SketchHelperStatement[] = [];
  while (cursor < body.length) {
    skip();
    if (cursor >= body.length) break;
    const next = parseStatement();
    if (!next) return undefined;
    statements.push(...next);
  }
  return statements;
}

function helperAlwaysReturns(statements: readonly SketchHelperStatement[]): boolean {
  for (const statement of statements) {
    if (statement.kind === "return") return true;
    if (helperAlwaysReturns(statement.then) && helperAlwaysReturns(statement.otherwise)) return true;
  }
  return false;
}

function extractNumericHelpers(source: string, diagnostics: SimulatorDiagnostic[]): Record<string, SketchHelperFunction> {
  const helpers: Record<string, SketchHelperFunction> = {};
  const signature = /\b(?:(?:static|inline)\s+)*((?:(?:unsigned|signed)\s+)?(?:char|short(?:\s+int)?|int|long(?:\s+long)?(?:\s+int)?|byte|bool|float|double|size_t|u?int(?:8|16|32|64)_t))\s+([A-Za-z_]\w*)\s*\(([^)]*)\)\s*\{/g;
  const parameterType = /^((?:(?:const|unsigned|signed)\s+)*(?:char|short(?:\s+int)?|int|long(?:\s+long)?(?:\s+int)?|byte|bool|float|double|size_t|u?int(?:8|16|32|64)_t))\s+([A-Za-z_]\w*)$/;
  for (const match of source.matchAll(signature)) {
    const returnType = match[1].replace(/\b(?:const|signed|unsigned)\b/g, "").trim();
    const name = match[2];
    const opening = match.index! + match[0].lastIndexOf("{");
    const closing = findClosingBrace(source, opening);
    const line = lineAt(source, match.index!);
    if (closing === undefined) {
      diagnostics.push({ severity: "error", code: "UNTERMINATED_HELPER_FUNCTION", message: `${name}() is missing its closing brace.`, line });
      continue;
    }
    const parsedParameters = (match[3].trim() ? match[3].split(",") : []).map(parameter => {
      if (!parameter.trim()) return undefined;
      const parsed = parameterType.exec(parameter.trim());
      return parsed ? { type: parsed[1].replace(/\bconst\b/g, "").trim(), name: parsed[2] } : undefined;
    });
    const body = parseHelperBody(source.slice(opening + 1, closing));
    if (parsedParameters.some(parameter => !parameter) || !body || !helperAlwaysReturns(body)) {
      diagnostics.push({ severity: "error", code: "UNSUPPORTED_HELPER_FUNCTION", message: `${name}() must use numeric parameters and a simple body made of if/else blocks and return expressions, with a return on every path.`, line });
      continue;
    }
    if (helpers[name]) {
      diagnostics.push({ severity: "error", code: "DUPLICATE_HELPER_FUNCTION", message: `${name}() is defined more than once.`, line });
      continue;
    }
    const parameters = parsedParameters as Array<{ type: string; name: string }>;
    helpers[name] = {
      name,
      returnType,
      parameters: parameters.map(parameter => parameter.name),
      parameterTypes: parameters.map(parameter => parameter.type),
      body,
      line,
    };
  }
  const expressionText = (statements: readonly SketchHelperStatement[]): string => statements.map(statement =>
    statement.kind === "return"
      ? statement.expression
      : `${statement.condition} ${expressionText(statement.then)} ${expressionText(statement.otherwise)}`,
  ).join(" ");
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const recursive = new Set<string>();
  const visit = (name: string) => {
    if (visiting.has(name)) { recursive.add(name); return; }
    if (visited.has(name)) return;
    visiting.add(name);
    const body = expressionText(helpers[name].body);
    for (const call of body.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) if (helpers[call[1]]) visit(call[1]);
    visiting.delete(name);
    visited.add(name);
  };
  Object.keys(helpers).forEach(visit);
  for (const name of recursive) diagnostics.push({ severity: "error", code: "RECURSIVE_HELPER_UNSUPPORTED", message: `${name}() recursively calls itself or another helper; recursive sketch helpers are outside the simulator subset.`, line: helpers[name].line });
  return helpers;
}

function collectConstants(source: string, boardId = "arduino-uno"): Map<string, number> {
  const constants = defaultConstants(boardId);
  const pending: Array<[string, string]> = [];

  for (const match of source.matchAll(/^\s*#define\s+([A-Za-z_]\w*)\s+([^\r\n]+)/gm)) {
    pending.push([match[1], match[2].trim()]);
  }

  const declaration = /\b(?:const\s+)?(?:unsigned\s+)?(?:int|long|short|byte|u?int(?:8|16|32|64)_t|size_t)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g;
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

function staticPrintValue(
  expression: string,
  constants: ReadonlyMap<string, number>,
  source: string,
  boardId: string,
): string | undefined {
  const trimmed = expression.trim();
  const literal = decodeStringLiteral(trimmed);
  if (literal !== undefined) return literal;

  const tokens = tokenizeExpression(trimmed);
  if (!tokens) return undefined;

  // `collectConstants` also contains initial values for mutable globals so
  // other compile-time contexts can resolve pin declarations. Those values
  // must not be baked into Serial output: a variable can change while the
  // sketch runs. Only preprocessor and built-in constants are safe to fold.
  const staticNames = new Set([
    ...defaultConstants(boardId).keys(),
    ...Object.keys(DEVICE_CONSTANTS),
    ...[...source.matchAll(/^\s*#define\s+([A-Za-z_]\w*)\b/gm)].map(match => match[1]),
  ]);
  if (tokens.some(token => token.type === "identifier" && !staticNames.has(token.value)
    && !staticNames.has(token.value.slice(token.value.lastIndexOf("::") + 2)))) return undefined;
  return printValue(trimmed, constants);
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
  boardId = "arduino-uno",
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

    if (/^(?:const\s+)?(?:unsigned\s+)?(?:int|long|short|byte|u?int(?:8|16|32|64)_t|size_t)\b/.test(statement.text)) {
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
      if (pin === undefined || !mode || (mode === "INPUT" ? !isBoardDigitalPin(boardId, pin) : !isBoardDigitalOutputPin(boardId, pin))) {
        diagnostics.push({
          severity: "error",
          code: "INVALID_PIN_MODE",
          message: `${callee} requires a valid ${boardId} pin and INPUT, OUTPUT, or INPUT_PULLUP; output modes cannot use input-only pins.`,
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
      if (pin === undefined || !isBoardDigitalOutputPin(boardId, pin)) {
        diagnostics.push({
          severity: "error",
          code: "INVALID_DIGITAL_WRITE",
          message: `${callee} requires an output-capable ${boardId} pin and HIGH/LOW (or 1/0).`,
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
      if (pin === undefined || !isBoardDigitalOutputPin(boardId, pin)) {
        diagnostics.push({
          severity: "error",
          code: "INVALID_ANALOG_WRITE",
          message: `${callee} requires an output-capable ${boardId} pin.`,
          line,
        });
        continue;
      }
      if (!isBoardPwmPin(boardId, pin)) {
        diagnostics.push({
          severity: "warning",
          code: "NON_PWM_PIN",
          message: `${boardPinLabel(boardId, pin)} is not a PWM-capable ${boardId} pin.`,
          line,
        });
      }
      if (rawValue === undefined) {
        instructions.push({ kind: "analogWriteExpression", pin, expression: args[1].trim(), ...sourceInfo });
        continue;
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

    if (callee === "delay" || callee === "delayMicroseconds") {
      const duration = args.length === 1 ? evaluateStatic(args[0], constants) : undefined;
      if (duration === undefined || duration < 0) {
        addArgumentError(diagnostics, line, callee, "one non-negative static duration");
        continue;
      }
      instructions.push({
        kind: "delay",
        durationMs: callee === "delayMicroseconds" ? duration / 1_000 : Math.round(duration),
        ...sourceInfo,
      });
      continue;
    }

    if (callee === "Serial.println" || callee === "Serial.print") {
      const value = args.length <= 1 ? staticPrintValue(args[0] ?? "", constants, source, boardId) : undefined;
      if (value !== undefined) instructions.push({ kind: "serialPrint", value, newline: callee === "Serial.println", ...sourceInfo });
      else if (args.length <= 1) instructions.push({ kind: "serialExpression", expression: args[0] ?? "", newline: callee === "Serial.println", ...sourceInfo });
      else addArgumentError(diagnostics, line, callee, "zero or one value");
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
  boardId = "arduino-uno",
): SketchInstruction[] {
  if (!body) return [];
  const instructions: SketchInstruction[] = [];
  const functionReturns: Array<Extract<SketchInstruction, { kind: "jump" }>> = [];
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
  const findStatementEnd = (start: number, limit = text.length): number | undefined => {
    const statementStart = skipWhitespace(start);
    if (statementStart >= limit) return undefined;
    if (text[statementStart] === "{") {
      const close = matching(statementStart, "{", "}");
      return close === undefined || close >= limit ? undefined : close + 1;
    }
    if (/^if\b/.test(text.slice(statementStart))) {
      const openParen = skipWhitespace(statementStart + 2);
      if (text[openParen] !== "(") return undefined;
      const closeParen = matching(openParen, "(", ")");
      if (closeParen === undefined) return undefined;
      const thenEnd = findStatementEnd(skipWhitespace(closeParen + 1), limit);
      if (thenEnd === undefined) return undefined;
      const afterThen = skipWhitespace(thenEnd);
      if (!/^else\b/.test(text.slice(afterThen))) return thenEnd;
      return findStatementEnd(skipWhitespace(afterThen + 4), limit);
    }
    let parentheses = 0;
    let brackets = 0;
    let quote = "";
    for (let cursor = statementStart; cursor < limit; cursor += 1) {
      const character = text[cursor];
      if (quote) {
        if (character === "\\") cursor += 1;
        else if (character === quote) quote = "";
        continue;
      }
      if (character === "\"" || character === "'") { quote = character; continue; }
      if (character === "(") parentheses += 1;
      else if (character === ")") parentheses -= 1;
      else if (character === "[") brackets += 1;
      else if (character === "]") brackets -= 1;
      else if (character === ";" && parentheses === 0 && brackets === 0) return cursor + 1;
    }
    return undefined;
  };
  const compileStatement = (start: number, end: number) => {
    const statementStart = skipWhitespace(start);
    if (text[statementStart] === "{") compileRange(statementStart + 1, end - 1);
    else compileRange(statementStart, end);
  };
  const compileSimple = (statement: string, localStart: number) => {
    const trimmed = statement.trim().replace(/\b([A-Za-z_]\w*)\.getResponse\(\)/g, "$1__response");
    const sourceInfo = { line: lineAt(source, body.startIndex + localStart), source: trimmed };
    const sdFileOpen = /^File\s+([A-Za-z_]\w*)\s*=\s*SD\.open\(([^,]+),\s*([^)]*)\)\s*;$/.exec(trimmed);
    if (sdFileOpen) { instructions.push({ kind: "fileOpen", name: sdFileOpen[1], path: sdFileOpen[2].trim(), mode: sdFileOpen[3].trim(), ...sourceInfo }); return; }
    if (/^return\s*;$/.test(trimmed)) {
      const jump = { kind: "jump" as const, target: 0, ...sourceInfo };
      functionReturns.push(jump); instructions.push(jump); return;
    }
    const buffer = /^(?:const\s+)?(?:byte|uint8_t|DeviceAddress)\s+([A-Za-z_]\w*)\s*(?:\[\s*([^\]]*)\s*\])?\s*(?:=\s*\{([^}]*)\})?\s*;$/.exec(trimmed);
    if (buffer && (trimmed.startsWith("DeviceAddress") || trimmed.includes("["))) {
      const items = buffer[3] ? splitArguments(buffer[3]) ?? [] : [];
      instructions.push({ kind: "bufferDeclare", name: buffer[1], size: buffer[2] || String(items.length || 8), values: items, ...sourceInfo }); return;
    }
    const bufferWrite = /^([A-Za-z_]\w*)\s*\[([^\]]+)\]\s*=\s*([^;]+);$/.exec(trimmed);
    if (bufferWrite) { instructions.push({ kind: "bufferWrite", name: bufferWrite[1], index: bufferWrite[2], expression: bufferWrite[3], ...sourceInfo }); return; }
    const declaration = /^(?:(?:const\s+)?(?:unsigned\s+)?(int|long|short|byte|u?int(?:8|16|32|64)_t|size_t|bool|float|double))\s+([A-Za-z_]\w*)(?:\s*=\s*([^;]+))?\s*;$/.exec(trimmed);
    if (declaration) {
      instructions.push({ kind: "declare", name: declaration[2], expression: declaration[3]?.trim() ?? "0", integer: !["float", "double"].includes(declaration[1]!), ...sourceInfo });
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
      const adapter = deviceInstances(source, boardId).get(instance)?.api;
      if (adapter) {
        const arity = adapter.methods[method];
        if (!arity || args.length < arity[0] || args.length > arity[1]) addArgumentError(diagnostics, sourceInfo.line, `${instance}.${method}`, arity ? `${arity[0]}..${arity[1]} arguments` : "a registered method");
        else instructions.push({ kind: "deviceCall", instance, method, args, ...sourceInfo });
        return;
      }
      if (instance === "Serial" && (method === "print" || method === "println") && args.length >= 1) {
        const staticValue = staticPrintValue(args[0], constants, source, boardId);
        if (staticValue !== undefined) instructions.push({ kind: "serialPrint", value: staticValue, newline: method === "println", ...sourceInfo });
        else instructions.push({ kind: "serialExpression", expression: args[0], newline: method === "println", ...sourceInfo }); return;
      }
      if (instance === "Serial" && method === "begin") return;
      if (instance === "Serial" && (method === "print" || method === "println") && args.length >= 1) {
        const value = staticPrintValue(args[0], constants, source, boardId);
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
    const shiftCall = /^shiftOut\s*\(([\s\S]*)\)\s*;$/.exec(trimmed);
    if (shiftCall) {
      const args = splitArguments(shiftCall[1]);
      if (args?.length === 4) instructions.push({ kind: "deviceCall", instance: "__core", method: "shiftOut", args, ...sourceInfo });
      else addArgumentError(diagnostics, sourceInfo.line, "shiftOut", "four arguments");
      return;
    }
    if (/^(?:sensors_event_t|DeviceAddress)\s+[A-Za-z_]/.test(trimmed)) return;
    const toneCall = /^(tone|noTone)\s*\(([\s\S]*)\)\s*;$/.exec(trimmed);
    if (toneCall) {
      const args = splitArguments(toneCall[2]);
      if (args && ((toneCall[1] === "tone" && args.length >= 2) || (toneCall[1] === "noTone" && args.length === 1))) {
        instructions.push({ kind: "tone", pinExpression: args[0], ...(toneCall[1] === "tone" ? { frequencyExpression: args[1] } : {}), ...sourceInfo });
      } else addArgumentError(diagnostics, sourceInfo.line, toneCall[1], toneCall[1] === "tone" ? "a pin and frequency" : "a pin");
      return;
    }
    const compiled = compileBody(source, { body: trimmed, startIndex: body.startIndex + localStart }, constants, diagnostics, boardId);
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
        const statementStart = skipWhitespace(closeParen + 1);
        const statementEnd = findStatementEnd(statementStart, rangeEnd);
        if (statementEnd === undefined) {
          diagnostics.push({ severity: "error", code: "INVALID_CONTROL_FLOW", message: `${isFor ? "for" : "while"} requires a supported statement or block.`, line: lineAt(source, body.startIndex + cursor) });
          break;
        }
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
        compileStatement(statementStart, statementEnd);
        if (increment) compileSimple(`${increment};`, statementEnd);
        instructions.push({ kind: "jump", target: loopStart, line: lineAt(source, body.startIndex + statementEnd), source: "loop" });
        (instructions[jumpIfIndex] as Extract<SketchInstruction, { kind: "jumpIfFalse" }>).target = instructions.length;
        cursor = statementEnd;
        continue;
      }
      if (/^if\b/.test(text.slice(cursor))) {
        const openParen = skipWhitespace(cursor + 2);
        if (text[openParen] !== "(") break;
        const closeParen = matching(openParen, "(", ")");
        if (closeParen === undefined) break;
        const statementStart = skipWhitespace(closeParen + 1);
        const thenEnd = findStatementEnd(statementStart, rangeEnd);
        if (thenEnd === undefined) {
          diagnostics.push({ severity: "error", code: "INVALID_CONTROL_FLOW", message: "if requires a supported statement or block.", line: lineAt(source, body.startIndex + cursor) });
          break;
        }
        const condition = text.slice(openParen + 1, closeParen).trim();
        const jumpIfIndex = instructions.length;
        instructions.push({ kind: "jumpIfFalse", expression: condition, target: 0, line: lineAt(source, body.startIndex + cursor), source: `if (${condition})` });
        compileStatement(statementStart, thenEnd);
        let next = skipWhitespace(thenEnd);
        if (/^else\b/.test(text.slice(next))) {
          const jumpIndex = instructions.length;
          instructions.push({ kind: "jump", target: 0, line: lineAt(source, body.startIndex + next), source: "else" });
          (instructions[jumpIfIndex] as Extract<SketchInstruction, { kind: "jumpIfFalse" }>).target = instructions.length;
          const elseStart = skipWhitespace(next + 4);
          const elseEnd = findStatementEnd(elseStart, rangeEnd);
          if (elseEnd === undefined) {
            diagnostics.push({ severity: "error", code: "INVALID_CONTROL_FLOW", message: "else requires a supported statement or block.", line: lineAt(source, body.startIndex + next) });
            break;
          }
          compileStatement(elseStart, elseEnd);
          next = elseEnd;
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
  functionReturns.forEach(instruction => { instruction.target = instructions.length; });
  return instructions;
}

function collectGlobalVariables(source: string, boardId = "arduino-uno"): Record<string, number> {
  const globals: Record<string, number> = {};
  const setupIndex = source.search(/\bvoid\s+setup\s*\(/);
  const prefix = setupIndex >= 0 ? source.slice(0, setupIndex) : source;
  const constants = defaultConstants(boardId);
  for (const match of prefix.matchAll(/^\s*#define\s+([A-Za-z_]\w*)\s+([^\r\n]+)/gm)) {
    const value = evaluateStatic(match[2].trim(), new Map([...constants, ...Object.entries(globals)]));
    if (value !== undefined) { globals[match[1]] = value; constants.set(match[1], value); }
  }
  for (const match of prefix.matchAll(/\b(?:unsigned\s+)?(?:int|long|short|byte|u?int(?:8|16|32|64)_t|size_t|bool|float|double)\s+([A-Za-z_]\w*)\s*=\s*([^;]+);/g)) {
    const value = evaluateStatic(match[2], new Map([...constants, ...Object.entries(globals)]));
    if (value !== undefined) globals[match[1]] = value;
  }
  return globals;
}

function collectIntegerVariables(source: string): string[] {
  const setupIndex = source.search(/\bvoid\s+setup\s*\(/);
  const prefix = setupIndex >= 0 ? source.slice(0, setupIndex) : source;
  const names = new Set<string>();
  const declaration = /\b(?:const\s+)?(?:unsigned\s+)?(?:int|long|short|byte|u?int(?:8|16|32|64)_t|size_t|bool)\s+([A-Za-z_]\w*)\s*(?:=[^;]*)?;/g;
  for (const match of prefix.matchAll(declaration)) names.add(match[1]!);
  return [...names];
}

/**
 * Compiles a deliberately small, deterministic Arduino C++ subset for the
 * browser simulator. Unsupported statements produce diagnostics rather than
 * executing arbitrary JavaScript.
 */
export function compileArduinoSketch(source: string, boardId = "arduino-uno"): CompiledArduinoSketch {
  const diagnostics: SimulatorDiagnostic[] = [];
  const masked = maskComments(source);
  const helpers = extractNumericHelpers(masked, diagnostics);
  diagnostics.push(...validateLibraryCalls(masked, boardId, Object.keys(helpers)));
  const uartCount = getBoardProfile(boardId)?.uart.length ?? 1;
  for (const match of masked.matchAll(/\bSerial([1-3])\s*\./g)) {
    const port = Number(match[1]);
    if (port >= uartCount) diagnostics.push({ severity: "error", code: "UART_PORT_UNAVAILABLE", line: lineAt(source, match.index ?? 0), message: `Serial${port} is not available on ${boardId}; its profile exposes ${uartCount} hardware UART port${uartCount === 1 ? "" : "s"}.` });
  }
  const constants = collectConstants(masked, boardId);
  Object.entries(DEVICE_CONSTANTS).forEach(([key, value]) => constants.set(key, value));
  const setupBody = extractFunction(masked, "setup", diagnostics);
  const loopBody = extractFunction(masked, "loop", diagnostics);
  const callbacks: { onReceive?: ReadonlyArray<SketchInstruction>; onRequest?: ReadonlyArray<SketchInstruction>; receiveParameter?: string } = {};
  for (const kind of ["onReceive", "onRequest"] as const) {
    const callbackName = new RegExp(`\\bWire\\s*\\.\\s*${kind}\\s*\\(\\s*([A-Za-z_]\\w*)\\s*\\)`).exec(masked)?.[1];
    if (!callbackName) continue;
    const callbackBody = extractFunction(masked, callbackName, diagnostics);
    if (!callbackBody) {
      diagnostics.push({ severity: "error", code: "I2C_CALLBACK_MISSING", message: `Wire.${kind}() refers to ${callbackName}, but that void function is not defined.` });
      continue;
    }
    callbacks[kind] = compileExecutableBody(masked, callbackBody, constants, diagnostics, boardId);
    if (kind === "onReceive") callbacks.receiveParameter = callbackBody.parameters?.[0];
  }

  if (!loopBody) {
    diagnostics.push({
      severity: "warning",
      code: "MISSING_LOOP",
      message: "No loop() function was found; the simulation will finish after setup().",
    });
  }

  const setup = compileExecutableBody(masked, setupBody, constants, diagnostics, boardId);
  const loop = compileExecutableBody(masked, loopBody, constants, diagnostics, boardId);

  return {
    source,
    setup,
    loop,
    globals: collectGlobalVariables(masked, boardId),
    integerVariables: collectIntegerVariables(masked),
    helpers,
    ...(Object.keys(callbacks).length ? { i2cCallbacks: callbacks } : {}),
    diagnostics,
    valid: !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
  };
}
