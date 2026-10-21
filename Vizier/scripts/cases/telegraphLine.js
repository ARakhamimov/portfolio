// telegraphLine.js, by Allen Rakhamimov.
// The telegraph equations on a resistive sheet: a damped wave of voltage.

'use strict';

caseRegister(() => ({
    id: 'telegraphLine',
    label: 'Telegraph waves',
    view: 'potential',
    note: 'A voltage pulse spreads as a ring and loses height to damping. It '
        + 'reflects with its sign flipped from the grounded left and right '
        + 'edges, and unflipped from the open top and bottom.',
    system: { physics: 'telegraph' },
    // A Courant number c dt / h of 0.25 at 256 cells.
    solver: { coarsestCells: 32, timeStep: 1 / 1024, stepsPerFrame: 4, cyclesPerFrame: 2 },
    // An OUTLET holds the voltage at zero, a grounded edge; a WALL carries no
    // current, an open one.
    geometry: { edges: { left: OUTLET, right: OUTLET, top: WALL, bottom: WALL } },
    inlet: { speed: 0 },
    // A Gaussian pulse in the voltage, smooth so it does not ring, the current
    // starting at rest.
    initial: {
        patches: [{ field: 'potential',
            value: (x, y) => Math.exp(-((x - 0.5) ** 2 + (y - 0.5) ** 2) / (2 * 0.05 ** 2)) }],
    },
    // Per unit time, against a crossing time of one. theta = 0.55 damps this
    // pulse by about 0.02 per unit time, 4% of the physical gamma / 2, which is
    // the condition the damped wave is admitted on.
    coefficients: {
        damping: 1,
        viscosity: 0.002,                       // read by nothing; the panel wants a number
    },
    sliders: { damping: [0.125, 8] },
    // The pulse starts at one, and its ring falls to a few tenths.
    display: { potentialScale: 0.3, fluxScale: 0.3 },
}));
