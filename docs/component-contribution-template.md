# Component contribution

Copy this template into the review description. Keep the component internal until its complete simulation passes acceptance.

## Identity

* Stable ID:
* Manufacturer and exact orderable part:
* Chip, bare sensor, or named breakout/module:
* Package and pin count (including exposed pads):
* Aliases, category, interfaces:
* Existing entries checked for duplicate hardware:

## Verified hardware sources

* Manufacturer datasheet URL, revision, page/table, review date:
* Physical pin number -> stable pin ID -> label -> direction -> signal type:
* Duplicate supply/ground pads and exposed-pad requirements:
* No-connect and reserved-pin instructions:
* Recommended supply ranges (separate from absolute maximum ratings):
* Relevant current ratings, units, test conditions, and source:
* Required external parts and variant-specific limitations:

## Library references

* Library registry/repository URL and header names:
* Hardware variant and supported host architectures:
* Maintenance status and license:
* Compatibility evidence; explicitly distinguish documentation from browser execution:
* Software-only libraries rejected from component publication:

## Registry and symbol

* Definition in lib/circuit/parts.ts; reusable IC/module symbol or justified custom artwork:
* Stable endpoints, readable labels, explicit pin numbers, positive symbol dimensions:
* Publication: internal during development; simulated only after acceptance:
* Supported behavior and explicit limitations:
* No catalog metadata copied into project instances; schemaVersion remains 1:

## Acceptance evidence

* Datasheet pinout manually compared, not inferred from library names:
* Registry validation, search by aliases/interfaces/libraries:
* Placement, wiring, hover tracing, inspector, save/load, import/export:
* Symbol inspected at 55% and 100%; pins remain reachable:
* Required: truth table, power loss, disabled/floating controls, conflicts, independent channels:
* Required: model registered in lib/simulator/models.ts and tests pass before capability promotion:
* Programming adapter: calls explicitly registered and unsupported calls rejected:
* Working example demonstrating the core purpose and observable output:
* Reset, pause, step, playback speed, and deterministic simulated time:
* AI executable generation, prompt retrieval, pin and programming validation:
* TypeScript, changed-file lint, relevant tests and representative existing projects:
