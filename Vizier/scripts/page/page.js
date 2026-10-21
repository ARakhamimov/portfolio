// page.js, by Allen Rakhamimov.
// The page: opens the GPU, builds a scene from the chosen case, wires the
// controls, and runs the frames. index.html is the markup it works on.
//
// start() is the recipe; each step is a function below it, in the order start
// calls them. A first read wants start(), buildScene(), tick() and
// everySecond(); capture and export can wait.

(() => {
'use strict';

const canvas = document.getElementById('plate');
const messageLine = document.getElementById('message');

// What the functions below share. Everything a preset can change lives in
// `scene` and is replaced whole when one is chosen: classification, shader,
// pipelines and buffers.
let device = null;
let context = null;
let scene = null;
let busyRebuilding = false;
let options = null;
const state = { frames: 0, fps: 0, totalFrames: 0, dispatches: 0, storage: '' };
const capture = { wanted: false, recording: null, starting: false };

// The sandbox's undo stack, and the coefficients and layout that last ran
// cleanly, which the divergence watchdog puts back.
let layoutHistory = [];
let healthyOverrides = null;
let healthyLayout = null;

async function start() {
    // 1. The application scripts, then a GPU device and the canvas it draws to.
    await loadApplicationScripts();
    if (!(await openDevice())) return;

    // 2. The first case.
    options = solverOptions();
    await buildScene();

    // 3. The controls, drawn for that case.
    installControls();

    // 4. A frame per animation frame, and the telemetry and watchdog once a second.
    requestAnimationFrame(tick);
    setInterval(everySecond, 1000);
}

// Opening the GPU

// The GPU device and the canvas it draws to, or false with a message saying
// why there is none.
async function openDevice() {
    if (!navigator.gpu) { reportNoWebGPU('This browser exposes no WebGPU API.'); return false; }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) { reportNoWebGPU('WebGPU is present but no adapter was returned.'); return false; }

    const hasBgraStorage = adapter.features.has('bgra8unorm-storage');
    device = await adapter.requestDevice({
        requiredFeatures: hasBgraStorage ? ['bgra8unorm-storage'] : [],
        requiredLimits: {
            maxStorageBufferBindingSize: adapter.limits.maxStorageBufferBindingSize,
            maxBufferSize: adapter.limits.maxBufferSize,
        },
    });
    // A lost device takes every buffer with it; running out of GPU memory is the
    // usual cause, so the message says so.
    device.lost.then((info) => say(
        `The GPU device was lost (${info.message || info.reason || 'no reason given'}). ` +
        'The most common cause is running out of GPU memory at a high resolution. ' +
        'Reload the page and choose a lower one.', true));

    const format = hasBgraStorage ? navigator.gpu.getPreferredCanvasFormat() : 'rgba8unorm';
    setPipelineFormat(format);

    context = canvas.getContext('webgpu');
    context.configure({ device, format, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.COPY_SRC });
    return true;
}

// Where a browser keeps WebGPU behind a setting, so a blank canvas comes with
// a way forward.
const WEBGPU_HELP = [
    ['Chrome and Edge', 'https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips'],
    ['Safari, including iOS', 'https://webkit.org/blog/14879/webgpu-now-available-for-testing-in-safari-technology-preview/'],
    ['Firefox', 'https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API#browser_compatibility'],
];

function reportNoWebGPU(detail) {
    const links = WEBGPU_HELP
        .map(([name, url]) => `<a href="${url}" target="_blank" rel="noreferrer">${name}</a>`)
        .join(' &middot; ');
    say(`${detail}<br><br>This runs on WebGPU, which some browsers keep behind a setting. ` +
        `On iOS Safari it is a flag under Settings, Apps, Safari, Advanced, Feature Flags.<br><br>${links}`,
        true, true);
}

// How the solver runs a frame, as the running case sets it.
function solverOptions() {
    return {
        paused: false,
        cyclesPerFrame: appCyclesPerFrame(),
        stepsPerFrame: appStepsPerFrame(),
        preSmooth: appPreSmooth,
        postSmooth: appPostSmooth,
        coarseSmooth: appCoarseSmooth,
        canvas: { width: canvas.width, height: canvas.height },
    };
}

// Building a scene

// keepView is false only when the viewer picked a different case, which
// opens on its own view; any other rebuild keeps what the viewer was
// looking at.
async function buildScene({ keepView = true } = {}) {
    const plate = new Plate(appFinestIndex(), appCoarsestInterior(), appAllocatedFields());
    appGeometry(plate);

    const largest = Math.max(...BUFFER_GROUPS.map((g) => plate.bufferBytes(g.name)));
    const totalBytes = BUFFER_GROUPS.reduce((sum, g) => sum + plate.bufferBytes(g.name), 0);
    // The memory watchdog: the device's stated limits are checked here, and
    // the allocation itself is caught by the error scopes below, since
    // WebGPU gives no figure for how much memory a device has.
    const limit = Math.min(device.limits.maxStorageBufferBindingSize, device.limits.maxBufferSize);
    if (largest > limit) {
        throw new Error(
            `this case needs a ${(largest / 1048576).toFixed(1)} MiB buffer against a device ` +
            `limit of ${(limit / 1048576).toFixed(1)} MiB. ` +
            'Choose a lower resolution.');
    }

    const system = appSystem();
    const table = appBoundaryTable();
    options.stepsPerFrame = appStepsPerFrame();
    const source = buildSimulationSource(plate, system, table, appWorkgroup, appActivePreset().display);

    const shaderModule = device.createShaderModule({ code: source, label: 'simulation' });
    const compilation = await shaderModule.getCompilationInfo();
    const errors = compilation.messages.filter((m) => m.type === 'error');
    if (errors.length) throw new Error(errors.map((m) => `line ${m.lineNum}: ${m.message}`).join('\n'));

    // WebGPU does not throw when an allocation fails; the error goes to
    // whatever scope is open. These are read before the new case replaces
    // the running one, so a failure leaves the previous case on screen.
    device.pushErrorScope('out-of-memory');
    device.pushErrorScope('validation');
    let buffers = null, groups = null, pipelines = null, thrown = null;
    try {
        buffers = createSimulationBuffers(device, plate);
        groups = createSimulationBindGroup(device, buffers, context.getCurrentTexture().createView());
        pipelines = createSimulationPipelines(device, shaderModule, groups.pipelineLayout, source);
    } catch (error) {
        thrown = error;
    }
    // Both scopes are closed whatever happened, or every later error on the
    // page would land in a scope nobody reads.
    const invalid = await device.popErrorScope();
    const outOfMemory = await device.popErrorScope();
    if (thrown) {
        if (buffers) for (const buffer of Object.values(buffers)) buffer.destroy();
        throw thrown;
    }
    if (outOfMemory || invalid) {
        for (const buffer of Object.values(buffers)) buffer.destroy();
        throw new Error(outOfMemory
            ? `the GPU could not allocate ${(totalBytes / 1048576).toFixed(1)} MiB for this case. ` +
              'Choose a lower resolution.'
            : `the GPU rejected this case's buffers or pipelines: ${invalid.message}`);
    }

    // The display switches start as CONTROLS_MEMBERS says; the live value is
    // in the controls buffer from here on.
    plate.hatchScale[0] = canvas.clientWidth ? canvas.width / canvas.clientWidth : 1;

    // The coefficients, with any slider the viewer has moved, so a
    // resolution change does not put one back.
    plate.setCoefficients(appCoefficientValues());

    appSeedFields(plate, system);
    uploadPlate(device, buffers, plate);

    const runner = new CycleRunner(device, plate, system, pipelines, groups, appWorkgroup);
    const next = {
        plate, system, table, runner, buffers, groups,
        telemetry: new MonitorsReader(device, buffers.controls, plate, PANEL_HEAT_FLUX_WINDOW,
            (message) => say(message, true)),
        reader: new StateReader(device, buffers, plate),
        storage: `${(totalBytes / 1048576).toFixed(1)} MiB, largest ${(largest / 1048576).toFixed(1)}`,
    };

    // Only after everything above has succeeded. A failed rebuild leaves the
    // previous case running rather than a blank canvas.
    if (scene) {
        // The display switches are a viewer's preference and carry across
        // a case change.
        for (const member of CONTROLS_MEMBERS) {
            if (member.kept) plate[member.name].set(scene.plate[member.name]);
        }

        // What is being looked at does not. The level is clamped anyway,
        // because a coarser hierarchy has fewer of them.
        if (keepView) {
            plate.viewMode[0] = scene.plate.viewMode[0];
            // Clamped to the fields the new case solves, or the panel would
            // name a field the shader's default arm is not drawing.
            plate.viewField[0] = Math.min(scene.plate.viewField[0],
                drawResidualFields(next.system).length - 1);
            plate.viewSpecies[0] = controlsOfferedSpecies(next.system,
                scene.plate.viewSpecies[0]);
            plate.viewMaterial[0] = drawOfferedMaterials(next.system)
                .some(({ value }) => value === scene.plate.viewMaterial[0]) ? scene.plate.viewMaterial[0] : 0;
            plate.viewLevel[0] = Math.min(scene.plate.viewLevel[0], plate.numLevels - 1);
        }
        uploadPlate(device, buffers, plate);
        for (const buffer of Object.values(scene.buffers)) buffer.destroy();
    }
    scene = next;
    state.totalFrames = 0;
    state.frames = 0;
    state.storage = next.storage;
    state.dispatches = countDispatches(runner, options);
    return next;
}

// Restarts the case without rebuilding it, keeping the view. Every solved
// field is zeroed first, since the seed writes only what a case declares.
function resetScene() {
    if (!scene) return;
    scene.telemetry.fieldHealth = null;
    scene.telemetry.heatFluxSamples = [];
    const { plate, system, table, buffers } = scene;
    for (const equation of system.equations) {
        plate[equation.field].fill(0);
        if (!equation.steady) plate[`${equation.field}Old`].fill(0);
    }
    appSeedFields(plate, system);
    uploadPlate(device, buffers, plate);
    state.totalFrames = 0;
    state.frames = 0;
}

// The dispatches one frame makes, for the solver readout: the frame is run
// against a stand-in device that counts them and submits nothing.
function countDispatches(runner, options) {
    const realDispatch = runner.dispatch;
    const realDevice = runner.device;
    const realPass = runner.pass;
    let count = 0;
    try {
        const pass = { setBindGroup() {}, end() {} };
        runner.dispatch = () => { count++; };
        runner.device = {
            createCommandEncoder: () => ({ beginComputePass: () => pass, finish: () => ({}) }),
            queue: { submit() {} },
        };
        runner.frame({ ...options, canvas: null }, null);
    } finally {
        runner.dispatch = realDispatch;
        runner.device = realDevice;
        runner.pass = realPass;
    }
    return count;
}

// Choosing a case, a resolution or a coefficient

async function selectPreset(id) {
    if (busyRebuilding) return;
    const previous = options.paused;
    busyRebuilding = true;
    setRebuilding(true);
    options.paused = true;
    say(`building ${casePreset(id).label}…`);
    try {
        appSelectPreset(id);
        await buildScene({ keepView: false });
        const named = VIEW_NAMES.indexOf(casePreset(id).view);
        scene.plate.viewMode[0] = controlsOfferedView(scene.system, Math.max(0, named));
        uploadPlate(device, scene.buffers, scene.plate);
        // A preset declares its own cycle budget and where its hierarchy
        // stops, so the budget is reloaded and the resolution list redrawn.
        options.cyclesPerFrame = appCyclesPerFrame();
        state.dispatches = countDispatches(scene.runner, options);
        drawResolutionOptions();
        drawPresetButtons();
        controlsDrawCoefficients(selectCoefficient);
        // A new case starts with nothing to undo, out of build mode, and
        // with nothing for the watchdog to restore: what ran cleanly
        // before was another case's.
        layoutHistory = [];
        editorReset();
        editorDrawCard(layoutEdit);
        healthyOverrides = appCoefficientOverrides();
        healthyLayout = JSON.stringify(appCurrentLayout());
        say('');
    } catch (error) {
        say(`could not build that case: ${error.message}`, true);
    } finally {
        busyRebuilding = false;
        setRebuilding(false);
        options.paused = previous;
        refresh();
    }
}

// A rebuild that keeps the view, so one case can be compared across meshes.
// On failure the previous resolution is put back, or the next rebuild for
// any reason would try the one that just failed.
async function selectResolution(interior) {
    if (busyRebuilding) return;
    const previousPaused = options.paused;
    const previousResolution = scene ? scene.plate.interior[0] : 0;
    busyRebuilding = true;
    setRebuilding(true);
    options.paused = true;
    say(`rebuilding at ${interior} cells…`);
    try {
        appSetResolution(interior);
        await buildScene();
        say('');
    } catch (error) {
        appSetResolution(previousResolution);
        say(`could not build at ${interior} cells: ${error.message}`, true);
    } finally {
        busyRebuilding = false;
        setRebuilding(false);
        options.paused = previousPaused;
        refresh();
    }
}

// Both rebuild paths take a few hundred milliseconds and neither is
// re-entrant, so the two controls that start one are held shut meanwhile.
function setRebuilding(on) {
    const select = document.getElementById('resolution');
    if (select) select.disabled = on;
    for (const button of document.getElementById('presets').children) button.disabled = on;
}

// A buffer write, live under the drag. The slider rows are not redrawn,
// since replacing a slider while it is dragged drops the drag.
function selectCoefficient(name, value) {
    appSetCoefficient(name, value);
    // A moved slider is a different case to average over.
    scene.telemetry.heatFluxSamples = [];
    scene.plate.setCoefficients(appCoefficientValues());
    writeCoefficients(device, scene.buffers, scene.plate);
    refresh();
}

// The options depend on where the running case's hierarchy stops, so they
// are rebuilt when a case is chosen. The listener is attached once.
function drawResolutionOptions() {
    const select = document.getElementById('resolution');
    select.replaceChildren();
    for (const interior of appResolutions()) {
        const option = document.createElement('option');
        option.value = String(interior);
        option.textContent = `${interior} cells`;
        select.append(option);
    }
}

function listenForResolution() {
    const select = document.getElementById('resolution');
    select.addEventListener('change', () => {
        selectResolution(Number(select.value));
        select.blur();
    });
}

// One button per case under its category, a row above that scrolls to a
// category, and the running case's reactions below.
function drawPresetButtons() {
    const active = appActivePreset();
    const presets = casePresets();
    const cases = [];
    for (const preset of presets) {
        if (!preset.defaultReaction || cases.some((entry) => entry.caseId === preset.caseId)) continue;
        cases.push(preset.caseId === active.caseId ? active : preset);
    }

    const host = document.getElementById('presets');
    const jumps = document.getElementById('presetCategories');
    host.replaceChildren();
    jumps.replaceChildren();
    for (const category of CASE_CATEGORIES) {
        const members = cases.filter((preset) => preset.category === category.name);
        if (!members.length) continue;
        const heading = document.createElement('h3');
        heading.className = 'presetGroup';
        heading.textContent = category.label;
        host.append(heading);
        const jump = document.createElement('button');
        jump.type = 'button';
        jump.textContent = category.label;
        jump.addEventListener('click', (event) => {
            host.scrollTop = heading.offsetTop;
            if (event.detail > 0) jump.blur();
        });
        jumps.append(jump);
        for (const preset of members) {
            const button = document.createElement('button');
            button.className = 'preset';
            button.type = 'button';
            button.setAttribute('aria-pressed', String(preset.caseId === active.caseId));
            const label = document.createElement('span');
            label.className = 'label';
            label.textContent = preset.caseLabel;
            const note = document.createElement('span');
            note.className = 'note';
            note.textContent = preset.note;
            button.append(label, note);
            // A case always opens on its default reaction, never on whichever
            // one the previous case was running.
            const target = preset.caseId === active.caseId ? active.id
                : presets.find((entry) => entry.caseId === preset.caseId && entry.defaultReaction).id;
            button.addEventListener('click', () => selectPreset(target));
            host.append(button);
        }
    }

    const reactions = document.getElementById('presetReactions');
    reactions.replaceChildren();
    const offered = presets.filter((preset) => preset.caseId === active.caseId && preset.reaction);
    document.getElementById('reactionCaption').hidden = offered.length === 0;
    reactions.hidden = offered.length === 0;
    for (const preset of offered) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = preset.reactionLabel;
        button.setAttribute('aria-pressed', String(preset.id === active.id));
        button.addEventListener('click', () => { if (preset.id !== active.id) selectPreset(preset.id); });
        reactions.append(button);
    }
    // What the running reaction is, in a sentence, under the row that chose it.
    const reactionNote = document.getElementById('reactionNote');
    reactionNote.textContent = active.reactionNote || '';
    reactionNote.hidden = !active.reactionNote;
}

// The controls

function installControls() {
    document.getElementById('exportRun').addEventListener('click', exportRun);
    document.getElementById('reset').addEventListener('click', () => { resetScene(); refresh(); });
    installCapture();
    controlsInstall(device, () => scene, options,
        { changed: refresh, exportRun, buildKey: (event) => editorKey(event, layoutEdit) });
    editorInstallPointer(canvas, layoutEdit);
    editorDrawCard(layoutEdit);
    drawResolutionOptions();
    listenForResolution();
    drawPresetButtons();
    controlsDrawCoefficients(selectCoefficient);
    healthyOverrides = appCoefficientOverrides();
    healthyLayout = JSON.stringify(appCurrentLayout());
    refresh();
}

// The bar, the legend and the panel, read again from the running scene.
function refresh() {
    controlsRefresh(scene.plate, scene.system, options);
    panelSyncEquations(scene.system);
    panelRefresh(scene.plate, scene.system, options, state, scene.telemetry);
}

// The sandbox editor

// The sandbox editor's edits. An edit is a new layout, asked of
// sandboxProblems first; an accepted one re-marks the running plate and
// writes the grid and coefficient buffers, never a rebuild, and the solver
// carries on from the fields it has.
const layoutEdit = {
    apply: applyLayout,
    remember(before) { layoutHistory.push(before); },
    canUndo: () => layoutHistory.length > 0,
    undo() {
        if (busyRebuilding || !layoutHistory.length) return;
        const key = sandboxLayoutGeometryKey(appCurrentLayout());
        appSetLayout(layoutHistory.pop());
        installLayout(key);
        editorDrawCard(layoutEdit);
        refresh();
    },
    reset() { applyLayout(appDeclaredLayout()); },
    // A saved case is a case file of plain data (sandboxExportText).
    save(label) {
        const taken = caseCases().map(({ id }) => id);
        const data = sandboxExportData(appActivePreset(), label, appCoefficientOverrides(), taken);
        diagnosticsDownload(sandboxExportText(data), `${data.id}.js`);
        say(`Saved ${data.label} as ${data.id}.js.`);
    },
    // Read as data, checked, then opened in the sandbox: its reaction
    // chosen, its sliders set and its layout applied, as a viewer would.
    async load(file) {
        if (busyRebuilding || !file) return;
        let data;
        try {
            data = sandboxParseExport(await file.text());
        } catch (error) {
            say(error.message, true);
            return;
        }
        const sandboxPresets = casePresets().filter((preset) => preset.caseId === 'sandbox');
        const sliders = COEFFICIENT_SLIDERS.map(({ name }) => name);
        const problems = sandboxImportProblems(data, sandboxPresets, sliders);
        if (problems.length) { say(problems.join(' '), true); return; }
        const target = sandboxPresets.find((preset) => (preset.reaction || 'none') === data.reaction);
        await selectPreset(target.id);
        for (const [name, value] of Object.entries(data.controls || {})) appSetCoefficient(name, value);
        controlsDrawCoefficients(selectCoefficient);
        if (applyLayout(data.layout)) {
            layoutHistory = [];
            editorDrawCard(layoutEdit);
            healthyOverrides = appCoefficientOverrides();
            healthyLayout = JSON.stringify(appCurrentLayout());
            say(`Loaded ${data.label}.`);
        }
    },
    refuse(sentence) { say(sentence, true); },
    redraw() { editorDrawCard(layoutEdit); refresh(); },
    coarsest: () => appCoarsestInterior(),
    finest: () => scene.plate.interior[0],
};

function installLayout(previousKey) {
    const plate = scene.plate;
    if (sandboxLayoutGeometryKey(appCurrentLayout()) !== previousKey) {
        appGeometry(plate);
        writeLayout(device, scene.buffers, plate);
    }
    plate.setCoefficients(appCoefficientValues());
    writeCoefficients(device, scene.buffers, plate);
}

function applyLayout(layout, { record = true, redraw = true } = {}) {
    if (busyRebuilding || !scene) return false;
    const problems = sandboxProblems(sandboxWithLayout(appActivePreset(), layout));
    if (problems.length) {
        say(problems.join(' '), true);
        if (redraw) editorDrawCard(layoutEdit);
        return false;
    }
    const before = appCurrentLayout();
    if (record) layoutHistory.push(before);
    appSetLayout(layout);
    installLayout(sandboxLayoutGeometryKey(before));
    // An accepted edit is the next thing to happen after a refusal.
    if (messageLine.classList.contains('error')) say('');
    if (redraw) editorDrawCard(layoutEdit);
    refresh();
    return true;
}

// Each frame and each second

// One animation frame: the solver's frame, then any capture.
function tick() {
    scene.groups.textureGroup = device.createBindGroup({
        layout: scene.groups.textureLayout,
        entries: [{ binding: 0, resource: context.getCurrentTexture().createView() }],
    });
    scene.runner.frame(options, 'drawField');
    state.frames++;
    if (!options.paused) state.totalFrames++;
    if (capture.wanted) takeSnapshot();
    if (capture.recording) tickRecording();
    requestAnimationFrame(tick);
}

// Once a second: the frame rate, the dispatch count and the telemetry, then
// the watchdog and the panel.
async function everySecond() {
    state.fps = state.frames;
    state.frames = 0;
    state.dispatches = countDispatches(scene.runner, options);
    await scene.telemetry.read();
    if (!options.paused && monitorsMeasureWallHeatFlux(scene.system)) scene.telemetry.sampleHeatFlux();
    watchHealth();
    refresh();
}

// The divergence watchdog. Once a second the telemetry brings back each
// solved field's largest magnitude; a NaN, an infinity or a value past the
// ceiling stops the run. The usual cause is a slider asking more of the
// fixed time step than it can carry, so the last coefficients and sandbox
// layout that ran cleanly are put back and the case restarts.

// Far above anything a case produces and far below where a diverging run is
// headed.
const WATCHDOG_CEILING = 1e6;

function watchHealth() {
    const health = scene.telemetry.fieldHealth;
    if (!health || options.paused || busyRebuilding) return;
    const failed = scene.system.equations
        .map((equation, slot) => ({ field: equation.field, value: health[slot] }))
        .find((entry) => !Number.isFinite(entry.value) || entry.value > WATCHDOG_CEILING);
    if (!failed) {
        healthyOverrides = appCoefficientOverrides();
        healthyLayout = JSON.stringify(appCurrentLayout());
        return;
    }

    options.paused = true;
    const what = `${controlsFieldLabel(failed.field)} reached ` +
        (Number.isFinite(failed.value) ? failed.value.toExponential(1) : String(failed.value));
    const current = appCoefficientOverrides();
    const moved = COEFFICIENT_SLIDERS
        .filter(({ name }) => current[name] !== healthyOverrides[name])
        .map(({ slider }) => slider);
    const layoutMoved = JSON.stringify(appCurrentLayout()) !== healthyLayout;
    if (layoutMoved) moved.push('the layout');
    if (moved.length) {
        appRestoreCoefficients(healthyOverrides);
        if (layoutMoved) {
            const key = sandboxLayoutGeometryKey(appCurrentLayout());
            appSetLayout(JSON.parse(healthyLayout));
            installLayout(key);
            editorDrawCard(layoutEdit);
        }
        scene.plate.setCoefficients(appCoefficientValues());
        controlsDrawCoefficients(selectCoefficient);
        resetScene();
        say(`The run diverged: ${what}. The last change to ${moved.join(' and ')} asked more ` +
            'of the time step than it can carry, so it is back where it last ran cleanly ' +
            'and the case has restarted. Press Play to continue.', true);
    } else {
        say(`The run diverged: ${what}. Paused; Reset restarts the case.`, true);
    }
}

// Messages

// The message strip. A progress line is cleared by what it reported on, a
// confirmation clears itself after ten seconds, and an error stays until the
// next thing happens.
let messageTimer = 0;

function say(text, isError = false, html = false, dismissAfter = 0) {
    clearTimeout(messageTimer);
    if (html) messageLine.innerHTML = text; else messageLine.textContent = text;
    messageLine.classList.toggle('error', isError);
    messageLine.classList.toggle('empty', !text);
    if (isError) console.error(text);
    if (dismissAfter) messageTimer = setTimeout(() => say(''), dismissAfter);
}

const SAY_CONFIRMATION = 10000;

// Export and capture

async function exportRun() {
    say('reading the buffers back…');
    try {
        const text = await diagnosticsReport(scene.reader, scene.plate, state.totalFrames,
            { caseLabel: appActivePreset().label, system: scene.system,
              equations: [...panelReactionText(scene.system),
                  ...panelEquationText(scene.system)],
              layout: Array.isArray(appActivePreset().geometry.ports)
                  ? sandboxLayoutText(appCurrentLayout()) : null });
        console.log(text);
        diagnosticsDownload(text,
            `run-${diagnosticsSlug(appActivePreset().id)}-${scene.plate.interior[0]}-${state.totalFrames}.txt`);
        say('written to the console and downloaded.', false, false, SAY_CONFIRMATION);
    } catch (error) {
        say(`diagnostics failed: ${error.message}`, true);
    }
}

// A WebGPU canvas holds its pixels only until the frame is presented, so a
// capture reads it inside the animation callback, after the draw; the button
// only sets a flag.

function captureFileName(extension) {
    return captureName(appActivePreset().id, scene.plate.interior[0], state.totalFrames, extension);
}

function takeSnapshot() {
    capture.wanted = false;
    const vision = controlsVisionName();
    const name = vision === 'normal' ? captureFileName('png')
        : captureFileName('png').replace(/\.png$/, `-${vision}.png`);
    captureImage(canvas, vision).toBlob((blob) => {
        if (!blob) { say('the browser returned no image data.', true); return; }
        diagnosticsDownload(blob, name);
        say(vision === 'normal' ? 'image saved.' : `image saved as ${vision} sees it.`,
            false, false, SAY_CONFIRMATION);
    }, 'image/png');
}

function tickRecording() {
    const frames = captureAddFrame(capture.recording, canvas);
    document.getElementById('recordReadout').textContent = `${frames} frames`;
    if (frames >= CAPTURE_FRAME_CAP) stopRecording();
}

function showRecording() {
    const button = document.getElementById('record');
    button.textContent = capture.recording ? 'Stop' : 'Record';
    button.setAttribute('aria-pressed', String(Boolean(capture.recording)));
    if (!capture.recording) document.getElementById('recordReadout').textContent = '';
    refresh();
}

async function startRecording() {
    if (!captureCanEncode()) {
        say('this browser cannot encode video.', true);
        return;
    }
    capture.starting = true;
    const recording = await captureOpenRecording(canvas, (error) => {
        capture.recording = null;
        showRecording();
        say(`recording failed: ${error.message}`, true);
    });
    capture.starting = false;
    if (!recording) { say('this browser has no video encoder that can write an MP4.', true); return; }
    capture.recording = recording;
    // The recording reads the canvas, which a CSS filter does not change.
    say(controlsVisionName() === 'normal' ? 'recording…'
        : `recording… (with normal color vision: the simulation is not recorded)`);
    showRecording();
}

async function stopRecording() {
    const recording = capture.recording;
    if (!recording) return;
    capture.recording = null;
    showRecording();
    say('saving the recording…');
    diagnosticsDownload(await captureCloseRecording(recording), captureFileName('mp4'));
    say('recording saved.', false, false, SAY_CONFIRMATION);
}

function installCapture() {
    document.getElementById('snapshot').addEventListener('click', () => {
        capture.wanted = true;
        say('capturing the next frame…');
    });
    const button = document.getElementById('record');
    button.addEventListener('click', () => {
        if (capture.starting) return;
        if (capture.recording) stopRecording(); else startRecording();
    });
}

start().catch((error) => say(String(error.stack || error.message || error), true));
})();
