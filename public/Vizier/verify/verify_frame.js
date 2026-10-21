// verify_frame.js, by Allen Rakhamimov.
// Every kernel a frame dispatches, against the kernels its shader generates.
//
// It runs the real frame against a recording stub; nothing is executed on a
// GPU, and what the kernels compute is not checked here.

// verify.html loads it, then runs the body it registers.
verifyCheck('verify_frame.js', function (process) {
'use strict';

let failures = 0;
const fail = (message) => { console.log(`  FAIL  ${message}`); failures++; };

// Every kernel the frame loop asks for exists
//
// The generator emits kernels from the system and the frame loop dispatches
// them by name. A system with no velocity generates no speed scan, so a
// dispatch the emitter did not generate fails at pipeline lookup in the
// browser. The emitter and the loop both ask monitorsMeasureSpeed, and this
// holds them to it by running the real frame against a recording stub, as
// countDispatches in page.js does to count them.
console.log('');
console.log('EVERY DISPATCHED KERNEL IS GENERATED');
{
    const opened = appActivePreset().id;
    let total = 0;
    let widest = 0;
    for (const preset of casePresets()) {
        appSelectPreset(preset.id);
        const presetPlate = new Plate(3);
        appGeometry(presetPlate);
        const system = appSystem();
        const source = buildSimulationSource(presetPlate, system, appBoundaryTable(), 8, appActivePreset().display);

        const generated = new Set();
        for (const match of source.matchAll(/@compute[\s\S]{0,80}?fn\s+([A-Za-z_]\w*)/g)) {
            generated.add(match[1]);
        }

        const asked = new Set();
        const pass = { setPipeline() {}, dispatchWorkgroups() {}, setBindGroup() {}, end() {} };
        const device = {
            createCommandEncoder: () => ({ beginComputePass: () => pass, finish: () => ({}) }),
            queue: { submit() {} },
        };
        // A pipelines map that answers every lookup and writes down what was
        // asked for. Returning a truthy value keeps the loop going past the
        // first missing name, so one run lists them all.
        const pipelines = { get(name) { asked.add(name); return true; } };
        const runner = new CycleRunner(device, presetPlate, system, pipelines, {}, 8);
        runner.frame({ paused: false, cyclesPerFrame: 1, stepsPerFrame: 1,
            preSmooth: 1, postSmooth: 1, coarseSmooth: 1, canvas: null }, null);

        for (const name of asked) {
            if (!generated.has(name)) {
                fail(`preset ${preset.id} dispatches ${name}, which its shader never generated`);
            }
        }
        total += asked.size;
        widest = Math.max(widest, asked.size);
    }
    appSelectPreset(opened);
    console.log(`  ${casePresets().length} presets, ${total} dispatches in one frame across`);
    console.log(`  all of them, ${widest} in the largest, every name defined by its own shader.`);
}

console.log(failures === 0
    ? '  No problems found.'
    : `  ${failures} problem(s).`);
process.exitCode = failures === 0 ? 0 : 1;
});
