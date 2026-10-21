// every_case_runs.js, by Allen Rakhamimov.
// Runs every case on the GPU for a while and checks that none of them blew up.
//
// Each case is built at its own mesh and run for a fixed number of frames.
// Then the largest magnitude each field holds is read back, the same number
// the page's divergence watchdog reads, and a NaN, an infinity or anything
// above the watchdog's ceiling fails the case. Before the real run, one case
// is run with its magnetic field a hundred times too strong, which has to
// blow up: an intended failure, which shows the check can see one.

'use strict';

const EVERY_CASE_FRAMES = 120;           // two seconds of simulated time at 60 frames a second
const EVERY_CASE_CEILING = 1e6;          // the same ceiling the page's watchdog uses

// Builds a case on the GPU, runs it, and returns each field's largest magnitude.
async function runCaseOnGpu(device, presetId, frames, coefficientChanges = {}) {
    appSelectPreset(presetId);
    for (const [name, value] of Object.entries(coefficientChanges)) appSetCoefficient(name, value);

    const plate = new Plate(appFinestIndex(), appCoarsestInterior(), appAllocatedFields());
    appGeometry(plate);
    const system = appSystem();
    const table = appBoundaryTable();
    const source = buildSimulationSource(plate, system, table, appWorkgroup, appActivePreset().display);

    const module = device.createShaderModule({ code: source, label: presetId });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((message) => message.type === 'error');
    if (errors.length) throw new Error(`the shader does not compile: line ${errors[0].lineNum}: ${errors[0].message}`);

    const buffers = createSimulationBuffers(device, plate);
    const canvasStandIn = device.createTexture({
        size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING,
    });
    const groups = createSimulationBindGroup(device, buffers, canvasStandIn.createView());
    const pipelines = await createSimulationPipelinesAsync(device, module, groups.pipelineLayout, source);

    plate.setCoefficients(appCoefficientValues());
    appSeedFields(plate, system);
    uploadPlate(device, buffers, plate);

    const runner = new CycleRunner(device, plate, system, pipelines, groups, appWorkgroup);
    const options = {
        paused: false,
        cyclesPerFrame: appCyclesPerFrame(),
        stepsPerFrame: appStepsPerFrame(),
        preSmooth: appPreSmooth,
        postSmooth: appPostSmooth,
        coarseSmooth: appCoarseSmooth,
        canvas: null,
    };
    for (let frame = 0; frame < frames; frame++) runner.frame(options, null);

    const largest = await readLargestFieldValues(device, buffers.controls, plate, system);
    for (const buffer of Object.values(buffers)) buffer.destroy();
    canvasStandIn.destroy();
    return largest;
}

// Copies the controls buffer back and reads each field's largest magnitude,
// which the frame's scan kernels wrote there.
async function readLargestFieldValues(device, controlsBuffer, plate, system) {
    const offset = plate.controlsByteOffset('fieldHealthBits');
    const size = plate.exportByteOffsetsControls.at(-1);
    const staging = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });

    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(controlsBuffer, 0, staging, 0, size);
    device.queue.submit([encoder.finish()]);
    await staging.mapAsync(GPUMapMode.READ);
    const values = new Float32Array(staging.getMappedRange().slice(0), offset, system.equations.length);
    staging.unmap();
    staging.destroy();

    const largest = {};
    system.equations.forEach((equation, slot) => { largest[equation.field] = values[slot]; });
    return largest;
}

function fieldsThatBlewUp(largest) {
    return Object.entries(largest).filter(([, value]) => !Number.isFinite(value) || value > EVERY_CASE_CEILING);
}

function describeLargestValues(largest) {
    return Object.entries(largest).map(([field, value]) => `${field} ${value.toPrecision(3)}`).join(', ');
}

// Every case, after the deliberate blow-up. Returns how many failed.
async function checkEveryCaseRuns(device, log, { frames = EVERY_CASE_FRAMES, only = null } = {}) {
    const original = appActivePreset().id;
    const format = pipelineFormat();
    setPipelineFormat('rgba8unorm');
    let failures = 0;
    try {
        log('EVERY CASE RUNS WITHOUT BLOWING UP');

        appSelectPreset('magneticWake');
        const tooStrong = 100 * appActivePreset().coefficients.appliedField;
        const control = await runCaseOnGpu(device, 'magneticWake', frames, { appliedField: tooStrong });
        if (fieldsThatBlewUp(control).length) {
            log(`  PASS  intended failure: magneticWake with its field x100 blew up (${describeLargestValues(control)})`);
        } else {
            failures++;
            log(`  FAIL  intended failure: magneticWake with its field x100 did not blow up, so this check cannot see a blow-up (${describeLargestValues(control)})`);
        }

        const presets = casePresets().filter((preset) => !only || only.includes(preset.id));
        let passed = 0;
        for (const preset of presets) {
            try {
                const largest = await runCaseOnGpu(device, preset.id, frames);
                if (fieldsThatBlewUp(largest).length) {
                    failures++;
                    log(`  FAIL  ${preset.id}: ${describeLargestValues(largest)}`);
                } else {
                    passed++;
                    log(`  PASS  ${preset.id}: ${describeLargestValues(largest)}`);
                }
            } catch (error) {
                failures++;
                log(`  FAIL  ${preset.id}: ${error.message}`);
            }
        }
        log(`  ${passed} of ${presets.length} cases ran ${frames} frames without blowing up.`);
    } finally {
        appSelectPreset(original);
        setPipelineFormat(format);
    }
    return failures;
}
