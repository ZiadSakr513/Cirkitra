# Component catalog and simulation

Every published component must work in simulation. The palette and AI generation use the same published registry. Internal definitions preserve draft project data while their models are developed; they are not palette entries. A draft containing an unavailable component must report the component and block simulation.

The 20-component expansion is still in development. Defining a pinout or listing a library does not complete a component. Do not describe this release as complete until every requested part has its programming interface, runnable example, failure tests, and UI acceptance evidence.

## Architecture

`lib/circuit/catalog.ts` supplies definitions to the palette, inspector, validation, geometry, rendering, and AI generation. Stable IDs, pin positions, endpoints, and version 1 project data remain compatible. Hardware metadata lives outside saved instances. Initial conditions are component properties; live measurements and packet buffers belong to the runtime.

`lib/simulator/models.ts` registers combinational models. `devices.ts` owns stateful devices and library adapters. `device-wiring.ts` resolves connections, supply requirements, addresses, and pull-ups. `one-wire.ts` shares conversion and scratchpad state between direct transactions and the DallasTemperature adapter. All progression uses simulated time.

The normalized digital/PWM solver handles logic and motor drive. Motor percentage is a drive level, not RPM. `power.ts` separately solves supported DC sources, resistive loads, sense resistors, battery charge, and ideal switches in volts and amps. This functional solver is not SPICE and does not model detailed battery chemistry. Wireless models use configured virtual peers, not RF propagation or additional programmed boards.

## Publication workflow

1. Discover hardware candidates from the [official library registry](https://github.com/arduino/library-registry) and [library metadata](https://docs.arduino.cc/arduino-cli/library-specification/). The discovery script deduplicates review candidates; it does not publish them.
2. Verify the exact chip or module package against manufacturer documentation. Distinct pinouts require distinct stable IDs.
3. Keep the definition internal while implementing its model, explicit programming adapter, controls, and runnable circuit example.
4. Test normal operation, missing supplies, disconnected signals, addressing conflicts, and reset/pause/step behavior. Inspect placement, wiring, live state, and save/load.
5. Publish only after the complete behavior promised for that component passes acceptance. Never expose a placeholder to make the catalog appear larger.

## Programming and generation

Generation always targets executable simulation. Relevant published definitions and supported methods must be supplied to the generator, and generated pins and code validated against the same registry. Requests for unavailable components receive a specific error rather than a silent replacement.

`device-api.ts` records adapter signatures; `libraries.ts` rejects unknown includes, calls, and overloads, including calls in expressions. This release does not execute arbitrary downloaded C++ libraries. An internal adapter manifest is not evidence that its component is ready for publication.

## Validation

`npm test` builds and runs the registered project, API, UI, catalog, and simulator suites. TypeScript and changed-source lint are separate checks. Use a separate localhost origin for browser acceptance so tests do not overwrite the user's saved project. Record uncompleted checks explicitly; passing unit tests alone does not satisfy the integrated release gate.
