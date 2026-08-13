import assert from "node:assert/strict";
import test from "node:test";

import { createDefaultBlinkProject } from "../../../../lib/circuit/default-project.ts";
import { maxDuration, POST } from "./route.ts";

const generatedEnvelope = {
  project: createDefaultBlinkProject(),
  explanation: "Generated a validated blink circuit.",
  assumptions: [],
  warnings: [],
};

test("allows complex generation to use the five-minute route window", () => {
  assert.equal(maxDuration, 300);
});

function modelResponse(text: string, finishReason = "STOP") {
  return Response.json({
    candidates: [{ finishReason, content: { parts: [{ text }] } }],
  });
}

function generationRequest(model?: string) {
  return new Request("http://localhost/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Blink an LED", ...(model ? { model } : {}) }),
  });
}

function requestWithCurrentProject(prompt: string) {
  return new Request("http://localhost/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt, currentProject: createDefaultBlinkProject() }),
  });
}

test("ordinary greetings receive a model-generated chat reply without circuit generation", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  let requestBody: {
    generationConfig: { maxOutputTokens: number; responseSchema: { required: string[] } };
    contents: Array<{ parts: Array<{ text: string }> }>;
  } | undefined;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return modelResponse(JSON.stringify({ reply: "Hello! How can I help with your circuit?" }));
  };

  const response = await POST(requestWithCurrentProject("hello"));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    kind: "chat",
    reply: "Hello! How can I help with your circuit?",
    model: "gemini-3.5-flash",
  });
  assert.equal(requestBody?.generationConfig.maxOutputTokens, 512);
  assert.deepEqual(requestBody?.generationConfig.responseSchema.required, ["reply"]);
  assert.equal(requestBody?.contents[0].parts[0].text, "hello");
});

test("standalone and ambiguous prompts create fresh circuits without current project context", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const requests: RequestInit[] = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {});
    return modelResponse(JSON.stringify(generatedEnvelope));
  };

  for (const prompt of ["Buzzer alert every second", "Traffic light with 3 LEDs", "Make something useful"]) {
    const response = await POST(requestWithCurrentProject(prompt));
    assert.equal(response.status, 200);
  }
  for (const request of requests) {
    const body = JSON.parse(String(request.body));
    const data = JSON.parse(body.contents[0].parts[0].text);
    assert.equal(data.mode, "create");
    assert.equal("currentProject" in data, false);
    assert.match(data.task, /fresh circuit/i);
  }
});

test("explicit edit prompts include the current project", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const requests: RequestInit[] = [];
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {});
    return modelResponse(JSON.stringify(generatedEnvelope));
  };

  for (const prompt of ["Add a buzzer to this traffic light", "Remove the LED", "Modify the current circuit"]) {
    const response = await POST(requestWithCurrentProject(prompt));
    assert.equal(response.status, 200);
  }
  for (const request of requests) {
    const body = JSON.parse(String(request.body));
    const data = JSON.parse(body.contents[0].parts[0].text);
    assert.equal(data.mode, "edit");
    assert.deepEqual(data.currentProject, createDefaultBlinkProject());
  }
});

test("forwards only the default and selected Gemini models", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const requests: Array<{ url: string; init?: RequestInit }> = [];

  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });

  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (input, init) => {
    requests.push({ url: String(input), init });
    return Response.json({
      candidates: [{
        finishReason: "STOP",
        content: { parts: [{ text: JSON.stringify(generatedEnvelope) }] },
      }],
    });
  };

  const defaultResponse = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Blink an LED" }),
  }));
  const liteResponse = await POST(new Request("http://localhost/api/ai/generate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "Blink an LED", model: "gemini-3.5-flash-lite" }),
  }));

  assert.equal(defaultResponse.status, 200);
  assert.equal(liteResponse.status, 200);
  assert.equal((await defaultResponse.json()).model, "gemini-3.5-flash");
  assert.equal((await liteResponse.json()).model, "gemini-3.5-flash-lite");
  assert.match(requests[0].url, /models\/gemini-3\.5-flash:generateContent$/);
  assert.match(requests[1].url, /models\/gemini-3\.5-flash-lite:generateContent$/);

  for (const request of requests) {
    const headers = new Headers(request.init?.headers);
    const body = JSON.parse(String(request.init?.body));
    assert.equal(headers.get("x-goog-api-key"), "test-secret");
    assert.equal(body.generationConfig.maxOutputTokens, 65_536);
    assert.equal(body.generationConfig.responseMimeType, "application/json");
    assert.equal(body.generationConfig.responseSchema.type, "object");
    assert.ok(body.generationConfig.responseSchema.properties.project);
    assert.equal("temperature" in body.generationConfig, false);
  }
});

test("repairs malformed JSON before returning a circuit", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const requests: RequestInit[] = [];
  const responses = [
    modelResponse('{"project":'),
    modelResponse(JSON.stringify(generatedEnvelope)),
  ];
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {});
    return responses.shift() ?? modelResponse("");
  };

  const response = await POST(generationRequest("gemini-3.5-flash-lite"));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).model, "gemini-3.5-flash-lite");
  assert.equal(requests.length, 2);
  const repairBody = JSON.parse(String(requests[1].body));
  const repairData = JSON.parse(repairBody.contents[0].parts[0].text);
  assert.equal(repairData.mode, "create");
  assert.match(repairData.task, /Repair the rejected circuit proposal/);
  assert.deepEqual(repairData.validationIssues, ["response invalid_json"]);
  assert.equal(repairData.rejectedResponse, '{"project":');
});

test("passes schema issues into the repair attempt", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const requests: RequestInit[] = [];
  const responses = [
    modelResponse(JSON.stringify({ project: {} })),
    modelResponse(JSON.stringify(generatedEnvelope)),
  ];
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {});
    return responses.shift() ?? modelResponse("");
  };

  const response = await POST(generationRequest());
  assert.equal(response.status, 200);
  const repairBody = JSON.parse(String(requests[1].body));
  const repairData = JSON.parse(repairBody.contents[0].parts[0].text);
  assert.ok(repairData.validationIssues.includes("project.schemaVersion must be 1"));
  assert.equal("details" in (await response.json()), false);
});

test("repairs simulator-unsupported Arduino code before accepting a project", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const requests: RequestInit[] = [];
  const unsupported = {
    ...generatedEnvelope,
    project: { ...generatedEnvelope.project, code: "void setup(){ lcd.unsupported(); } void loop(){}" },
  };
  const responses = [modelResponse(JSON.stringify(unsupported)), modelResponse(JSON.stringify(generatedEnvelope))];
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {});
    return responses.shift() ?? modelResponse("");
  };
  const response = await POST(generationRequest());
  assert.equal(response.status, 200);
  assert.equal(requests.length, 2);
  const repairBody = JSON.parse(String(requests[1].body));
  const repairData = JSON.parse(repairBody.contents[0].parts[0].text);
  assert.ok(repairData.validationIssues.some((issue: string) => issue.includes("project.code simulator UNSUPPORTED_CALL")));
});

test("regenerates cleanly when repair is also malformed", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  const requests: RequestInit[] = [];
  const responses = [
    modelResponse("not json"),
    modelResponse("still not json"),
    modelResponse(JSON.stringify(generatedEnvelope)),
  ];
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async (_input, init) => {
    requests.push(init ?? {});
    return responses.shift() ?? modelResponse("");
  };

  const response = await POST(generationRequest());
  assert.equal(response.status, 200);
  assert.equal(requests.length, 3);
  const firstBody = JSON.parse(String(requests[0].body));
  const repairBody = JSON.parse(String(requests[1].body));
  const regeneratedBody = JSON.parse(String(requests[2].body));
  assert.equal(
    regeneratedBody.contents[0].parts[0].text,
    firstBody.contents[0].parts[0].text,
  );
  assert.equal(JSON.parse(regeneratedBody.contents[0].parts[0].text).mode, "create");
  assert.notEqual(
    repairBody.contents[0].parts[0].text,
    firstBody.contents[0].parts[0].text,
  );
});

test("returns one friendly error after all recovery attempts fail", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  let calls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async () => {
    calls += 1;
    return modelResponse("malformed");
  };

  const response = await POST(generationRequest());
  const body = await response.json();
  assert.equal(response.status, 502);
  assert.equal(calls, 3);
  assert.equal(body.error.code, "AI_GENERATION_INCOMPLETE");
  assert.equal(body.error.message, "We couldn’t finish this circuit right now. Please try again.");
  assert.equal("details" in body.error, false);
});

test("terminal provider failures do not trigger recovery calls", async (context) => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.GEMINI_API_KEY;
  let calls = 0;
  context.after(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = originalKey;
  });
  process.env.GEMINI_API_KEY = "test-secret";
  globalThis.fetch = async () => {
    calls += 1;
    return Response.json({ error: { message: "rate limited" } }, { status: 429 });
  };

  const response = await POST(generationRequest());
  assert.equal(response.status, 429);
  assert.equal(calls, 1);
  assert.equal((await response.json()).error.code, "AI_RATE_LIMITED");
});
