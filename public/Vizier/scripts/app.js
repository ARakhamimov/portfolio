// app.js, by Allen Rakhamimov.
// Which case the page is showing, the viewer's changes to it, and what the
// page builds from the two.
//
// appSystem, appBoundaryTable and appGeometry take no arguments and read the
// active preset themselves, so anything that assembles the shader goes on
// working across a change of case. Nothing in the solver depends on this file.

'use strict';

const appWorkgroup = 8;

// Which case is showing, and what the viewer changed

// One id. The page rebuilds everything when it changes, so nothing may hold a
// system or a table across a change.
let appPresetId = 'cylinderWake';

// The viewer's slider values and sandbox layout. Choosing a case clears both,
// since a preset declares its own; a resolution change keeps both. They are
// laid over the preset and never written onto it.
let appCoefficients = {};
let appLayout = null;

// A viewer's override of the preset's resolution, cleared when a case is
// chosen.
let appResolutionOverride = 0;

function appSelectPreset(id) {
    casePreset(id);   // throws on a name that does not exist
    appPresetId = id;
    appResolutionOverride = 0;
    appCoefficients = {};
    appLayout = null;
}

function appBasePreset() {
    return casePreset(appPresetId);
}

function appActivePreset() {
    const preset = appMeshScaled(appBasePreset());
    if (!Object.keys(appCoefficients).length && !appLayout) return preset;
    const controlled = caseWithControls(preset, appCoefficients);
    return appLayout ? sandboxWithLayout(controlled, appLayout) : controlled;
}

// A case whose step is held near h^2 declares it at its own mesh; at another
// resolution the step moves with the square of the spacing, so a finer mesh
// plays slower and stays stable.
function appMeshScaled(preset) {
    const cells = appResolutionOverride;
    if (!(cells > 0) || cells === preset.solver.cells || preset.solver.timeStepScaling !== 'spacingSquared') {
        return preset;
    }
    const ratio = preset.solver.cells / cells;
    return { ...preset, solver: { ...preset.solver, cells, timeStep: preset.solver.timeStep * ratio * ratio } };
}

function appSetCoefficient(name, value) {
    appCoefficients[name] = value;
}

// A copy of the slider values, and a way to put one back: the divergence
// watchdog restores the last set that ran cleanly.
function appCoefficientOverrides() {
    return { ...appCoefficients };
}

function appRestoreCoefficients(overrides) {
    appCoefficients = { ...overrides };
}

function appSetLayout(layout) {
    appLayout = layout ? sandboxCopyLayout(layout) : null;
}

function appCurrentLayout() {
    return sandboxLayoutOf(appActivePreset());
}

function appDeclaredLayout() {
    return sandboxLayoutOf(appBasePreset());
}

function appSetResolution(interior) {
    appResolutionOverride = interior;
}

// The coefficient slots

// Every slot, from the running case and the viewer's sliders. A value made of
// two controls is made here, so a slot stays one number a term reads: Monod's
// uptake is the growth rate over the yield, and the yield never reaches the
// shader. A slot the case does not read holds zero.
function appCoefficientValues() {
    const preset = appActivePreset();
    return {
        ...coefficientSlotValues(caseConstants(preset)),
        ...casePortSlotValues(preset.geometry.ports || []),
    };
}

// What the page builds, from the active preset

function appSystem() {
    return physicsSystem(appActivePreset());
}

function appBoundaryTable() {
    return physicsBoundaryTable(appActivePreset());
}

function appGeometry(plate) {
    caseGeometry(plate, appActivePreset());
}

function appSeedFields(plate, system) {
    physicsSeed(plate, system, appActivePreset());
}

// The running system's theta: 0.55 everywhere but a wave function's 0.5.
function appTheta() {
    const unsteady = appSystem().equations.find((equation) => !equation.steady);
    return unsteady ? unsteady.theta : CASE_THETA;
}

// The fields the running system gets arrays for (simulationFields).
function appAllocatedFields() {
    return simulationFields(appSystem());
}
function appTimeStep() { return appActivePreset().solver.timeStep; }
function appStepsPerFrame() { return appActivePreset().solver.stepsPerFrame; }

// A fixed budget with no convergence check. With advection the residual
// settles each frame without falling further, so the budget buys a bounded
// residual and not a converged one; the divergence view shows which a case has.
function appCyclesPerFrame() { return appActivePreset().solver.cyclesPerFrame; }
const appPreSmooth = 2;
const appPostSmooth = 2;
// 40 sweeps on the coarsest level in place of an exact solve. Doubling them
// moved the convergence factor per cycle by about 0.01 at most.
const appCoarseSmooth = 40;

// Meshes

function appFinestIndex() {
    const wanted = appResolutionOverride > 0
        ? MESH_SIZES.indexOf(appResolutionOverride) : -1;
    return wanted >= 0 ? wanted : MESH_SIZES.indexOf(appActivePreset().solver.cells);
}

function appCoarsestInterior() { return appActivePreset().solver.coarsestCells; }

// The coarsest level any case stops at. The row of view levels is keyed to it,
// so a case that stops coarser disables a button and the row does not reflow.
function appShallowestCoarsest() {
    return Math.min(...casePresets().map((preset) => preset.solver.coarsestCells));
}

// The meshes the running case may run at: every mesh size above its coarsest
// level, so even the finest choice has a coarse level to correct with.
function appResolutions() {
    return MESH_SIZES.filter((cells) => cells > appCoarsestInterior());
}

// The meshes a view level can show, for every case at once: a coarsest level
// is a level to look at but never a mesh to run at.
function appViewSizes() {
    return MESH_SIZES.filter((cells) => cells >= appShallowestCoarsest());
}
