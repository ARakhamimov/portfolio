// manifest.js, by Allen Rakhamimov.
// The order every script loads in, for the app, the verification page and the
// checks, and the case list as the case box groups it.
//
// The scripts are classic scripts sharing one lexical scope, so a file that
// reads another's top-level declarations as it loads comes after it. Both pages
// load through this list and the checks read it, so it has no copies.

'use strict';

// The solver: the WGSL it runs, and the layout that WGSL is written against.
const SIMULATION_SCRIPTS = [
    'scripts/solver/wgslLiterals.js',
    'scripts/solver/grid.js',
    'scripts/solver/fields.js',
    'scripts/solver/geometry.js',
    'scripts/solver/boundary.js',
    'scripts/solver/coefficients.js',
    'scripts/solver/multigrid.js',
    'scripts/solver/operators.js',
    'scripts/solver/terms.js',
    'scripts/solver/equations.js',
    'scripts/solver/system.js',
    'scripts/solver/kernels.js',
    'scripts/solver/monitors.js',
];

// The picture: its colors, its views, the draw shader and the legend.
const DISPLAY_SCRIPTS = [
    'scripts/display/display.js',
    'scripts/display/views.js',
    'scripts/display/draw.js',
    'scripts/display/legend.js',
];

// The host side and the page, on top of the solver and the picture. cases.js,
// physics.js and profiles.js come first, and the case files straight after
// them; page/page.js is not listed, since it is what loads this list.
const APPLICATION_SCRIPTS = [
    'scripts/cases.js',
    'scripts/physics.js',
    'scripts/cases/profiles.js',
    'scripts/sandbox.js',
    'scripts/app.js',
    'scripts/runtime.js',
    'scripts/page/pageElements.js',
    'scripts/page/diagnostics.js',
    'scripts/page/controls.js',
    'scripts/page/editor.js',
    'scripts/page/equationPanel.js',
    'scripts/page/casePanel.js',
    'scripts/page/capture.js',
];

// One file per case, named for its id, under the heading the case box lists
// it under, in the box's order. A case's category is the heading it is listed
// under here.
const CASE_CATEGORIES = [
    { name: 'diffusion', label: 'No flow',
      cases: ['heatConduction', 'compositeWall', 'layeredMembrane', 'heatedMembrane', 'reactingPatches'] },
    { name: 'channels', label: 'Channels',
      cases: ['emptyChannel', 'snakingChannel', 'selectivityReactor'] },
    { name: 'obstacles', label: 'Obstacles and wakes',
      cases: ['cylinderWake', 'wakeAtMeshLimit', 'tubeBank'] },
    { name: 'jets', label: 'Cavities and jets',
      cases: ['mixingLayer', 'lidDrivenCavity', 'opposedJets', 'offsetJets', 'tubeBankOffsetJets'] },
    { name: 'buoyancy', label: 'Buoyant flows',
      cases: ['heatedCavity', 'rayleighBenard', 'rayleighTaylor', 'windOverHeavyLayer'] },
    { name: 'porous', label: 'Porous media',
      cases: ['packedBed', 'packedBedFouled'] },
    { name: 'patterns', label: 'Patterns',
      cases: ['patternGrayScott', 'patternOregonator'] },
    { name: 'electric', label: 'Electromagnetics',
      cases: ['electrostaticMonopole', 'electrostaticDipole', 'electrostaticQuadrupole', 'dielectricDipole',
          'dielectricLens', 'magneticShield', 'magneticWake', 'magneticThruster', 'telegraphLine'] },
    { name: 'quantum', label: 'Wave functions',
      cases: ['singleSlit', 'doubleSlit', 'tunnelingBarrier', 'harmonicOscillator', 'twoPackets'] },
    { name: 'sandbox', label: 'Sandbox',
      cases: ['sandbox'] },
];

const CASE_SCRIPTS = CASE_CATEGORIES.flatMap(({ cases }) => cases.map((id) => `scripts/cases/${id}.js`));

function allApplicationScripts() {
    const [cases, physics, profiles, ...rest] = APPLICATION_SCRIPTS;
    return [...SIMULATION_SCRIPTS, ...DISPLAY_SCRIPTS, cases, physics, profiles, ...CASE_SCRIPTS, ...rest];
}

// Loads them in order as classic scripts, awaiting each, so that a failure
// names the file that failed.
async function loadApplicationScripts(base = '') {
    for (const path of allApplicationScripts()) {
        await new Promise((resolve, reject) => {
            const element = document.createElement('script');
            element.src = base + path;
            element.async = false;
            element.onload = resolve;
            element.onerror = () => reject(new Error(`failed to load ${path}`));
            document.head.appendChild(element);
        });
    }
}
