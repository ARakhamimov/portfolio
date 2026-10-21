// electrostaticMonopole.js, by Allen Rakhamimov.
// A single charge in a grounded box.

'use strict';

caseRegister(() => ({
    id: 'electrostaticMonopole',
    label: 'Point charge',
    view: 'potential',
    note: 'A single charge in a grounded box. The potential falls from the '
        + 'charge to zero at the walls, and the field points straight out.',
    system: { physics: 'electrostatics' },
    // A coarsest level of 16, not 32: at 32 the grounded box's lowest mode
    // converges slowly. The rows are steady, so the step only counts frames.
    solver: { coarsestCells: 16, timeStep: 1 / 60, stepsPerFrame: 1, cyclesPerFrame: 3 },
    // A grounded box: every edge an OUTLET, which holds the potential at
    // zero and leaves the flux through it free.
    geometry: { edges: { left: OUTLET, right: OUTLET, top: OUTLET, bottom: OUTLET } },
    inlet: { speed: 0 },
    charges: [
        { x: 0.5, y: 0.5, radius: 0.04, density: 50 },
    ],
    coefficients: {
        inversePermittivity: 1,
        viscosity: 0.002,                   // read by nothing; the panel wants a number
    },
    // From a run at 64 cells: a peak potential of 0.08 to 0.14, and a field
    // of order one at a charge's edge.
    display: { potentialScale: 0.1, fluxScale: 0.6 },
}));
