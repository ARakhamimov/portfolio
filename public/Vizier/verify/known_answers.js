// known_answers.js, by Allen Rakhamimov.
// Two problems whose answer is known exactly, solved on the GPU by the solver
// Vizier runs: the shader it generates, the V-cycle in runtime.js, the boundary
// fill and the time stepping.
//
//   1. A sine mode decaying under the heat equation between walls held at 0.
//      The mode is an exact eigenvector of the five-point Laplacian with the
//      mirrored ghost points, so after n steps of the theta method its
//      amplitude is exactly G^n, with G the theta method's amplification
//      factor for that eigenvalue.
//   2. Fully developed flow in a channel, fed a parabola at the inlet. Second
//      differences of a quadratic are exact, so the discrete profile is a
//      quadratic too, a (y (1 - y) + h^2 / 4), with a fixed by the flux the
//      inlet carries, and the pressure falls at the rate 2 nu a.
//
// Each check also judges its result against a slightly wrong answer (theta 0.5
// for the first, the continuous parabola for the second), which has to fail:
// that shows the tolerance is tight enough to see an error of that size.
//
// What this does not check: anything a case adds beyond these two operators,
// such as advection, a rate law or a varying coefficient. every_case_runs.js
// checks that those run without blowing up.

'use strict';

const KNOWN_ANSWER_CELLS = 64;

// Builds a system on the GPU for a plate and boundary table written here, not
// taken from a case, so the problem is exactly the one stated above.
async function buildKnownAnswer(device, plate, system, table) {
    const source = buildSimulationSource(plate, system, table, appWorkgroup, appActivePreset().display);
    const module = device.createShaderModule({ code: source, label: system.name });
    const info = await module.getCompilationInfo();
    const errors = info.messages.filter((message) => message.type === 'error');
    if (errors.length) throw new Error(`the shader does not compile: line ${errors[0].lineNum}: ${errors[0].message}`);

    const buffers = createSimulationBuffers(device, plate);
    const canvasStandIn = device.createTexture({
        size: [1, 1], format: 'rgba8unorm', usage: GPUTextureUsage.STORAGE_BINDING,
    });
    const groups = createSimulationBindGroup(device, buffers, canvasStandIn.createView());
    const pipelines = await createSimulationPipelinesAsync(device, module, groups.pipelineLayout, source);
    uploadPlate(device, buffers, plate);
    const runner = new CycleRunner(device, plate, system, pipelines, groups, appWorkgroup);
    const finish = () => {
        for (const buffer of Object.values(buffers)) buffer.destroy();
        canvasStandIn.destroy();
    };
    return { runner, reader: new StateReader(device, buffers, plate), finish };
}

function runKnownAnswerFrames(runner, frames, cyclesPerFrame) {
    const options = {
        paused: false, cyclesPerFrame, stepsPerFrame: 1, canvas: null,
        preSmooth: appPreSmooth, postSmooth: appPostSmooth, coarseSmooth: appCoarseSmooth,
    };
    for (let frame = 0; frame < frames; frame++) runner.frame(options, null);
}

function knownAnswerTable(fields) {
    const table = defaultBoundaryTable();
    const both = (value) => ({ surface: { kind: DIRICHLET, value }, tangential: { kind: DIRICHLET, value } });
    for (const [type, values] of Object.entries(fields)) {
        table[type].fields = Object.fromEntries(Object.entries(values).map(([field, value]) => [field, both(value)]));
    }
    return table;
}

// 1. The decaying mode
async function checkDecayingMode(device, log) {
    const diffusivity = 1;
    const theta = CASE_THETA;
    const timeStep = 0.005;
    const steps = 40;
    const system = normalizeSystem({
        name: 'decayingMode',
        equations: [{ field: 'temperature', location: CENTER, role: ROLE_SCALAR, theta, timeStep,
            terms: [{ term: 'diffusion', diffusivity }] }],
        relaxation: { scheme: POINTWISE },
    });
    const plate = new Plate(MESH_SIZES.indexOf(KNOWN_ANSWER_CELLS), 16, simulationFields(system));
    addGeometry(plate, { edges: { left: WALL, right: WALL, top: WALL, bottom: WALL } });
    const table = knownAnswerTable({ [WALL]: { temperature: 0 } });

    const spacing = plate.spacing[0];
    const cells = plate.interior[0];
    const mode = (column, row) => Math.sin(Math.PI * (column - 0.5) * spacing) * Math.sin(Math.PI * (row - 0.5) * spacing);
    for (let row = 1; row <= cells; row++) {
        for (let column = 1; column <= cells; column++) {
            const p = plate.indexCenter(0, column, row);
            plate.temperature[p] = mode(column, row);
            plate.temperatureOld[p] = mode(column, row);
        }
    }

    const built = await buildKnownAnswer(device, plate, system, table);
    runKnownAnswerFrames(built.runner, steps, 8);
    const fields = await built.reader.read();
    built.finish();

    let projection = 0, norm = 0;
    for (let row = 1; row <= cells; row++) {
        for (let column = 1; column <= cells; column++) {
            projection += fields.temperature[plate.indexCenter(0, column, row)] * mode(column, row);
            norm += mode(column, row) ** 2;
        }
    }
    const amplitude = projection / norm;

    // The eigenvalue of the five-point Laplacian for this mode, both axes.
    const eigenvalue = 2 * (2 - 2 * Math.cos(Math.PI * spacing)) / spacing ** 2;
    const factor = (weight) => (1 - (1 - weight) * diffusivity * eigenvalue * timeStep)
        / (1 + weight * diffusivity * eigenvalue * timeStep);
    const exact = factor(theta) ** steps;
    const wrong = factor(0.5) ** steps;
    const tolerance = 1e-4;
    const error = Math.abs(amplitude - exact) / exact;
    const control = Math.abs(amplitude - wrong) / wrong;

    log(`  amplitude after ${steps} steps ${amplitude.toExponential(6)}, theta ${theta}: exact `
        + `${exact.toExponential(6)}, relative error ${error.toExponential(2)}`);
    log(`  continuous decay exp(-2 pi^2 D t) ${Math.exp(-2 * Math.PI ** 2 * diffusivity * steps * timeStep).toExponential(6)}, for comparison`);
    let failures = 0;
    if (error < tolerance) log(`  PASS  within ${tolerance} of G^n`);
    else { failures++; log(`  FAIL  ${error.toExponential(2)} from G^n, above ${tolerance}`); }
    if (control >= tolerance) log(`  PASS  control: ${control.toExponential(2)} from theta 0.5's G^n, which the tolerance tells apart`);
    else { failures++; log(`  FAIL  control: theta 0.5's answer is only ${control.toExponential(2)} away, so the tolerance cannot tell them apart`); }
    return failures;
}

// 2. The channel
async function checkChannelFlow(device, log) {
    const viscosity = 0.05;
    const steady = { steady: true };
    const system = normalizeSystem({
        name: 'channelFlow',
        equations: [
            { field: 'xVelocity', location: XFACE, role: ROLE_VELOCITY, ...steady,
              terms: [{ term: 'diffusion', diffusivity: viscosity },
                      { term: 'gradientOf', field: 'pressure', component: 'x' }] },
            { field: 'yVelocity', location: YFACE, role: ROLE_VELOCITY, ...steady,
              terms: [{ term: 'diffusion', diffusivity: viscosity },
                      { term: 'gradientOf', field: 'pressure', component: 'y' }] },
            { field: 'pressure', location: CENTER, role: ROLE_PRESSURE, constraint: true, steady: true,
              terms: [{ term: 'divergenceOf', xField: 'xVelocity', yField: 'yVelocity' }] },
        ],
        relaxation: { scheme: SCHUR_RELAXATION, c: 0.5 },
    });
    const plate = new Plate(MESH_SIZES.indexOf(KNOWN_ANSWER_CELLS), 16, simulationFields(system));
    addGeometry(plate, { edges: { left: INLET, right: OUTLET, top: WALL, bottom: WALL } });
    // Mean speed 1, peak 1.5.
    const table = knownAnswerTable({ [INLET]: {
        xVelocity: positionProfile('6.0 * position.y * (1.0 - position.y)'), yVelocity: 0 } });

    const built = await buildKnownAnswer(device, plate, system, table);
    runKnownAnswerFrames(built.runner, 80, 3);
    const fields = await built.reader.read();
    built.finish();

    const spacing = plate.spacing[0];
    const cells = plate.interior[0];
    const y = (row) => (row - 0.5) * spacing;
    // The discrete profile a (y (1 - y) + h^2 / 4), carrying the inlet's flux.
    let inletFlux = 0, shapeFlux = 0;
    for (let row = 1; row <= cells; row++) {
        inletFlux += 6 * y(row) * (1 - y(row)) * spacing;
        shapeFlux += (y(row) * (1 - y(row)) + spacing ** 2 / 4) * spacing;
    }
    const a = inletFlux / shapeFlux;

    // The middle x-face column, and the pressure slope across the middle quarter.
    const middle = cells / 2 + 1;
    let error = 0, control = 0;
    for (let row = 1; row <= cells; row++) {
        const u = fields.xVelocity[plate.indexXFace(0, middle, row)];
        error = Math.max(error, Math.abs(u - a * (y(row) * (1 - y(row)) + spacing ** 2 / 4)) / 1.5);
        control = Math.max(control, Math.abs(u - 6 * y(row) * (1 - y(row))) / 1.5);
    }
    const from = 3 * cells / 8, to = 5 * cells / 8;
    const slope = (fields.pressure[plate.indexCenter(0, to, cells / 2)]
        - fields.pressure[plate.indexCenter(0, from, cells / 2)]) / ((to - from) * spacing);
    const exactSlope = -2 * viscosity * a;
    const slopeError = Math.abs(slope - exactSlope) / Math.abs(exactSlope);

    const tolerance = 1e-4;
    log(`  u at x = 0.5 against a (y (1 - y) + h^2/4), a = ${a.toPrecision(7)}: largest error `
        + `${error.toExponential(2)} of the peak`);
    log(`  pressure slope ${slope.toPrecision(7)} against -2 nu a = ${exactSlope.toPrecision(7)}: `
        + `relative error ${slopeError.toExponential(2)}`);
    let failures = 0;
    if (error < tolerance) log(`  PASS  profile within ${tolerance} of the peak`);
    else { failures++; log(`  FAIL  profile ${error.toExponential(2)} from the discrete answer, above ${tolerance}`); }
    if (slopeError < tolerance) log(`  PASS  pressure slope within ${tolerance}`);
    else { failures++; log(`  FAIL  pressure slope ${slopeError.toExponential(2)} off, above ${tolerance}`); }
    if (control >= tolerance) log(`  PASS  control: the continuous parabola is ${control.toExponential(2)} away, which the tolerance tells apart`);
    else { failures++; log(`  FAIL  control: the continuous parabola is only ${control.toExponential(2)} away, so the tolerance cannot tell them apart`); }
    return failures;
}

// Both, with the active case put back afterwards. Returns how many failed.
async function checkKnownAnswers(device, log) {
    const original = appActivePreset().id;
    const format = pipelineFormat();
    setPipelineFormat('rgba8unorm');
    let failures = 0;
    try {
        log('A DECAYING SINE MODE, AGAINST THE THETA METHOD\'S OWN FACTOR');
        appSelectPreset('heatConduction');
        failures += await checkDecayingMode(device, log);
        log('');
        log('FULLY DEVELOPED CHANNEL FLOW, AGAINST THE DISCRETE PARABOLA');
        appSelectPreset('emptyChannel');
        failures += await checkChannelFlow(device, log);
    } finally {
        appSelectPreset(original);
        setPipelineFormat(format);
    }
    return failures;
}
