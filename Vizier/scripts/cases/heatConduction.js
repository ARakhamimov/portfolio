// heatConduction.js, by Allen Rakhamimov.
// The heat equation alone, in a box with one hot edge and two cold bars.

'use strict';

caseRegister(() => ({
    id: 'heatConduction',
    label: 'Heat conduction',
    view: 'temperature',
    note: 'Heat spreads from one hot edge toward three cold edges and two '
        + 'cold bars, with no flow. The residual view shows how few multigrid '
        + 'passes it needs.',
    system: { physics: 'conduction' },
    // The hot edge is typed INLET because the boundary table is keyed on type
    // and every WALL shares one temperature. Nothing flows through it.
    geometry: {
        edges: { left: INLET, right: WALL, top: WALL, bottom: WALL },
        solidBoxes: [[0.30, 0.15, 0.36, 0.70], [0.60, 0.30, 0.66, 0.85]],
    },
    inlet: { speed: 0, temperature: 100 },
    wall: { temperature: 0 },
    // A viscosity of zero, since nothing reads it here; zero also keeps its
    // slider off the page.
    coefficients: { viscosity: 0, thermalDiffusivity: 0.02 },
    sliders: { thermalDiffusivity: [0.0025, 0.16] },
}));
