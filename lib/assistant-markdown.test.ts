import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAssistantMarkdown } from "./assistant-markdown.ts";

test("compact code explanations become readable ordered and nested lists", () => {
  const result = normalizeAssistantMarkdown(
    "Here is the sketch line by line: 1. **setup() function:**- Serial.begin(9600); starts serial communication. - pinMode(3, OUTPUT) configures the motor. 2. **loop() function:**- Reads the sensor.",
  );

  assert.match(result, /line by line:\n\n1\. \*\*setup\(\) function:\*\*\n   - Serial\.begin/);
  assert.match(result, /\n   - pinMode\(3, OUTPUT\)/);
  assert.match(result, /\n2\. \*\*loop\(\) function:\*\*\n   - Reads/);
});

test("normalization preserves ordinary hyphenated words and existing paragraphs", () => {
  const result = normalizeAssistantMarkdown("Use a non-blocking loop.\n\nThis keeps the timing stable.");

  assert.equal(result, "Use a non-blocking loop.\n\nThis keeps the timing stable.");
});
