// runtime.js, by Allen Rakhamimov.
// From a case's system to a running frame: assemble the WGSL, compile a
// pipeline per entry point, allocate and upload the buffers, and issue the
// dispatches a frame is made of.
//
// Two halves: building a scene, then CycleRunner, where frame and
// advanceOneTimeStep are the methods to read; the V-cycle each time step runs
// is vCycle in multigrid.js. Nothing here knows what any equation says.

'use strict';

// Building a scene

// `display` is the case's display scales (a preset's display group), which the
// draw shader writes in as literals.
function buildSimulationSource(plate, system, table, workgroup, display) {
    const parts = [];

    parts.push(makeStructCode(plate));
    parts.push(makeBindingCode(pipelineFormat()));
    parts.push(makeIndexCode());
    parts.push(makeTransferHelperCode());
    parts.push(makeBoundaryHelperCode());
    // The velocity's operators, and the advection function that reads them,
    // where there is a velocity to read.
    if (kernelsHasVelocity(system)) {
        parts.push(makeOperatorCode());
        parts.push(makeDiscretizationFunctionCode(system));
    }

    for (const equation of system.equations) {
        const names = arrayNamesFor(equation.field, equation.location,
            { history: !equation.constraint });

        parts.push(makeBoundaryCode(equation.field, names.value, equation.location, equation.role, table));
        parts.push(makeEquationCode(equation, names));
        parts.push(makeFasCode(equation, names));

        // The solution, the residual and the history are restricted out of
        // their own arrays, and the change is prolongated out of a fourth.
        parts.push(makeRestrictCode(`${equation.field}Value`, equation.location, names.value));
        parts.push(makeRestrictCode(`${equation.field}Residual`, equation.location, names.residual));
        if (!equation.steady) {
            parts.push(makeRestrictCode(`${equation.field}History`, equation.location, names.history));
        }
        parts.push(makeProlongCode(`${equation.field}Change`, equation.location, names.restricted));
    }

    parts.push(makeSystemCode(system, (equation) =>
        arrayNamesFor(equation.field, equation.location, { history: !equation.constraint })));

    parts.push(makeKernelCode(system, (equation) =>
        arrayNamesFor(equation.field, equation.location, { history: !equation.constraint }), workgroup, plate.numLevels));

    // The draw kernel last: it reads the same arrays at controls.viewLevel and
    // not at the level the solver is on.
    const centerFields = FIELD_SPEC.filter((spec) => spec.location === CENTER
        && plate.fieldArrays.some((array) => array.name === spec.name)).map((spec) => spec.name);
    const { speciesScale, potentialScale, fluxScale, currentScale, fieldLineScale, waveScale } = display;
    parts.push(makeDrawAccessorCode(centerFields));
    parts.push(makeDrawCode(plate, { ...displaySettings, workgroup, system,
        speciesScale, potentialScale, fluxScale, currentScale, fieldLineScale, waveScale }));

    return parts.join('\n');
}

// The canvas format, which the draw shader is written for. bgra8unorm storage
// is optional in WebGPU, so a device without it draws to rgba8unorm.
let pipelineStorageFormat = 'rgba8unorm';

function setPipelineFormat(format) { pipelineStorageFormat = format; }

function pipelineFormat() { return pipelineStorageFormat; }

function entryPointNames(source) {
    const names = [];
    for (const match of source.matchAll(/@compute[\s\S]{0,80}?fn\s+([A-Za-z_]\w*)/g)) names.push(match[1]);
    return names;
}

function createSimulationPipelines(device, module, layout, source) {
    const pipelines = new Map();
    for (const name of entryPointNames(source)) {
        pipelines.set(name, device.createComputePipeline({
            layout, compute: { module, entryPoint: name },
        }));
    }
    return pipelines;
}

// The same, off the main thread, for verify.html: a case has up to about a
// hundred entry points, and compiling them synchronously froze the page. A
// failure arrives as a rejected promise, not in an error scope.
async function createSimulationPipelinesAsync(device, module, layout, source) {
    const built = await Promise.all(entryPointNames(source).map((name) =>
        device.createComputePipelineAsync({ layout, compute: { module, entryPoint: name } })
            .then((pipeline) => [name, pipeline])));
    return new Map(built);
}

// Seven storage buffers; the canvas texture is bound separately.
function createSimulationBuffers(device, plate) {
    const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
    const buffers = {};

    buffers.layout = device.createBuffer({
        label: 'layout', size: plate.exportByteOffsetsLayout.at(-1), usage,
    });
    for (const group of BUFFER_GROUPS) {
        buffers[group.name] = device.createBuffer({
            label: group.name, size: plate.bufferBytes(group.name), usage,
        });
    }
    buffers.controls = device.createBuffer({
        label: 'controls', size: plate.exportByteOffsetsControls.at(-1), usage,
    });
    buffers.coefficients = device.createBuffer({
        label: 'coefficients', size: plate.exportByteOffsetsCoefficients.at(-1), usage,
    });

    return buffers;
}

function writeGroup(device, buffer, arrays, offsets) {
    arrays.forEach((array, index) => device.queue.writeBuffer(buffer, offsets[index], array));
}

function uploadPlate(device, buffers, plate) {
    writeLayout(device, buffers, plate);
    writeGroup(device, buffers.controls, plate.exportControls, plate.exportByteOffsetsControls);
    writeCoefficients(device, buffers, plate);
    for (const group of BUFFER_GROUPS) {
        writeGroup(device, buffers[group.name], plate.exportGroups[group.name],
            plate.exportByteOffsets[group.name]);
    }
}

// The grid's sizes, offsets, classification and paint. Written alone when the
// sandbox re-marks the running plate, which is all it takes to move a shape.
function writeLayout(device, buffers, plate) {
    writeGroup(device, buffers.layout, plate.exportLayout, plate.exportByteOffsetsLayout);
}

// Every coefficient slot at once: a handful of floats, and writing only the one
// that moved would leave the rest at whatever a previous case put there.
function writeCoefficients(device, buffers, plate) {
    writeGroup(device, buffers.coefficients, plate.exportCoefficients,
        plate.exportByteOffsetsCoefficients);
}

// Group 0 is the canvas texture and group 1 the seven buffers (makeBindingCode).
// Every kernel shares the draw kernel's pipeline layout, so every submission
// binds group 0.
function createSimulationBindGroup(device, buffers, canvasView) {
    const textureLayout = device.createBindGroupLayout({
        entries: [{
            binding: 0, visibility: GPUShaderStage.COMPUTE,
            storageTexture: { access: 'write-only', format: pipelineFormat() },
        }],
    });

    const bufferLayout = device.createBindGroupLayout({
        entries: [0, 1, 2, 3, 4, 5, 6].map((binding) => ({
            binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' },
        })),
    });

    const textureGroup = device.createBindGroup({
        layout: textureLayout,
        entries: [{ binding: 0, resource: canvasView }],
    });

    // A canvas view is valid only inside the animation callback that got it.
    // Binding an expired one makes the driver reject the whole command buffer
    // without a word, and the solver silently does not advance, so every
    // submission that does not draw binds this one-pixel stand-in instead.
    const idleTexture = device.createTexture({
        label: 'compute-only canvas stand-in',
        size: [1, 1],
        format: pipelineFormat(),
        usage: GPUTextureUsage.STORAGE_BINDING,
    });

    const computeGroup = device.createBindGroup({
        layout: textureLayout,
        entries: [{ binding: 0, resource: idleTexture.createView() }],
    });

    const bufferGroup = device.createBindGroup({
        layout: bufferLayout,
        entries: [
            { binding: 0, resource: { buffer: buffers.layout } },
            { binding: 1, resource: { buffer: buffers.centerState } },
            { binding: 2, resource: { buffer: buffers.centerWorkspace } },
            { binding: 3, resource: { buffer: buffers.xFace } },
            { binding: 4, resource: { buffer: buffers.yFace } },
            { binding: 5, resource: { buffer: buffers.controls } },
            { binding: 6, resource: { buffer: buffers.coefficients } },
        ],
    });

    const pipelineLayout = device.createPipelineLayout({
        bindGroupLayouts: [textureLayout, bufferLayout],
    });

    return { textureGroup, computeGroup, bufferGroup, pipelineLayout, textureLayout };
}

// The frame, as dispatches
//
// A frame is one compute pass. The level is set by a one-thread kernel rather
// than a binding, so no dispatch needs the pass to end.

// The points a kernel covers, in the field's own index space: the interior
// unknowns (an x-face field has one more column than cells), or the whole array.
function dispatchExtent(plate, location, level, includeMargin) {
    if (includeMargin) {
        return [plate.widthAt(location, level), plate.heightAt(location, level)];
    }
    const interiorCells = plate.interior[level];
    if (location === XFACE) return [interiorCells + 1, interiorCells];
    if (location === YFACE) return [interiorCells, interiorCells + 1];
    return [interiorCells, interiorCells];
}

class CycleRunner {

    constructor(device, plate, system, pipelines, groups, workgroup) {
        this.device = device;
        this.plate = plate;
        this.system = system;
        this.pipelines = pipelines;
        this.groups = groups;
        this.workgroup = workgroup;
        this.pass = null;
    }

    // Dispatching

    dispatch(name, gridX, gridY) {
        const pipeline = this.pipelines.get(name);
        if (!pipeline) throw new Error(`no pipeline for ${name}; the kernel was never generated`);
        this.pass.setPipeline(pipeline);
        this.pass.dispatchWorkgroups(
            Math.ceil(gridX / this.workgroup), Math.ceil(gridY / this.workgroup));
    }

    // The extent comes from the kernel's own shape, never from the call site: a
    // margin kernel at the interior extent leaves the outer ring unwritten, which
    // looks in the picture like a physical bias.
    dispatchForField(kernel, equation, level) {
        const margin = marginKernels().includes(kernel);
        const [x, y] = dispatchExtent(this.plate, equation.location, level, margin);
        this.dispatch(`${kernel}_${equation.field}`, x, y);
    }

    // A kernel per level: a queue write is ordered against submitted work and
    // not against the encoder being built, so every write would land before the
    // pass ran.
    setLevel(level) {
        this.dispatch(`setLevel${level}`, 1, 1);
    }

    // Fills every field's ghost cells and boundary points from the case's
    // boundary conditions.
    fillBoundaries(level) {
        for (const equation of this.system.equations) this.dispatchForField('fill', equation, level);
    }

    // The largest speed on a level, for the panel and the velocity view.
    measurePeakSpeed(level) {
        if (!monitorsMeasureSpeed(this.system)) return;
        this.dispatch('resetVelocityMax', 1, 1);
        const interiorCells = this.plate.interior[level];
        this.dispatch('scanVelocityMax', interiorCells, interiorCells);
        this.dispatch('recordVelocityMax', 1, 1);
    }

    // One compute pass.

    beginPass(textureGroup) {
        this.encoder = this.device.createCommandEncoder();
        this.pass = this.encoder.beginComputePass();
        this.pass.setBindGroup(0, textureGroup || this.groups.computeGroup);
        this.pass.setBindGroup(1, this.groups.bufferGroup);
    }

    endPass() {
        this.pass.end();
        this.pass = null;
        this.device.queue.submit([this.encoder.finish()]);
        this.encoder = null;
    }

    // One frame: a fixed budget of cycles per time step, with no convergence
    // check, and the picture.

    frame(options, drawKernel) {
        const drawing = Boolean(drawKernel && options.canvas);
        // Only a frame that draws binds the canvas (createSimulationBindGroup).
        this.beginPass(drawing ? this.groups.textureGroup : undefined);
        // A plate just uploaded from the host has no ghost points filled. On
        // any later frame this refill changes nothing, since a cycle ends with
        // one.
        this.setLevel(0);
        this.fillBoundaries(0);
        if (!options.paused) {
            // The step comes from stability, so a frame takes as many as the
            // case asks for.
            const steps = Math.max(1, options.stepsPerFrame || 1);
            for (let step = 0; step < steps; step++) this.advanceOneTimeStep(options);
            this.measureForDisplay();
        }
        if (drawing) this.drawPicture(drawKernel, options.canvas);
        this.endPass();
    }

    // The new level becomes the old one, then the fixed budget of V-cycles
    // solves for the new one.
    advanceOneTimeStep(options) {
        for (const equation of this.system.equations) {
            if (!equation.steady) this.dispatchForField('shiftHistory', equation, 0);
        }
        for (let cycle = 0; cycle < options.cyclesPerFrame; cycle++) vCycle(this, options);
    }

    // The divergence view's field, the watchdog's scan and the wall heat flux,
    // on the finest level only: a blow-up reaches every level within a cycle.
    measureForDisplay() {
        this.setLevel(0);
        if (kernelsHasVelocity(this.system)) {
            this.dispatch('computeDivergence', this.plate.interior[0], this.plate.interior[0]);
        }
        this.dispatch('resetFieldHealth', 1, 1);
        for (const equation of this.system.equations) this.dispatchForField('scanHealth', equation, 0);
        if (monitorsMeasureWallHeatFlux(this.system)) this.dispatch('measureWallHeatFlux', 1, 1);
    }

    // Over the canvas, one invocation per pixel, not over the grid. The stream
    // function goes first, paused or not, since the level shown may change
    // while paused, and only where the system has one.
    drawPicture(drawKernel, canvas) {
        if (this.plate.streamlines[0] && divergenceFreePair(this.system)) {
            this.dispatch('drawStreamRow', 1, 1);
            this.dispatch('drawStreamColumns', this.plate.interior[0] + 1, 1);
        }
        this.dispatch(drawKernel, canvas.width, canvas.height);
    }
}
