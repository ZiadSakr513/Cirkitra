# Zircuit

Zircuit is a browser-based Arduino Uno workbench. Describe a circuit, review the generated schematic and C++ sketch, edit either one, then run the supported firmware subset in a deterministic digital simulator.

## Included in v1

- Gemini-backed structured circuit generation with strict server-side validation
- Editable schematic with a supported component library, draggable parts, and pin-to-pin wiring
- Arduino code editor with build diagnostics, run/pause/reset/step controls, speed selection, live outputs, and Serial monitor
- Local autosave plus portable `.aics` project import/export
- Selectable Gemini 3.5 Flash and Gemini 3.5 Flash-Lite models
- Explicit Gemini error handling that preserves the open project when generation fails
- Responsive dark workbench interface

## Local setup

Requires Node.js 22.13 or newer.

```bash
npm install
copy .env.example .env.local
npm run dev
```

Add a newly-created Google AI Studio key to `.env.local`:

```text
GEMINI_API_KEY=your_replacement_key
```

Never commit `.env.local`; environment files are ignored by Git.

## Validation

```bash
npm test
npm run lint
```

The browser runtime intentionally implements a safe Arduino subset: `pinMode`, `digitalWrite`, static `analogWrite`, `delay`, and static `Serial.print/println`. Unsupported C++ control flow or peripherals are surfaced as diagnostics instead of being executed unsafely. The `/api/compile` route currently produces simulator IR; connecting an isolated Arduino CLI worker is the next step for true AVR binary compilation.
