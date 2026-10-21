// dielectricDipole.js, by Allen Rakhamimov.
// A dipole beside a dielectric slab ten times as polarizable as the space
// around it.

'use strict';

caseRegister(() => {
    // The slab as a profile on 1/eps: its own 1/10 as the base, lifted to one
    // outside. Ten and not a ceramic's hundreds, since the multigrid
    // correction stops converging somewhere above thirty.
    const slab = coefficientProfile(0.1,
        positionProfile('select(10.0, 1.0, position.x > 0.62 && position.x < 0.78)'));
    return {
        id: 'dielectricDipole',
        label: 'Dipole beside a dielectric',
        view: 'potential',
        note: 'The dipole beside a slab ten times more polarizable than its '
            + 'surroundings. The slab draws the field in, and the potential '
            + 'flattens across it.',
        system: { physics: 'electrostatics' },
        // A coarsest level of 16, not 32: at 32 the grounded box's lowest mode
        // converges slowly. The rows are steady, so the step only counts
        // frames.
        solver: { coarsestCells: 16, timeStep: 1 / 60, stepsPerFrame: 1, cyclesPerFrame: 3 },
        // A grounded box: every edge an OUTLET, which holds the potential at
        // zero and leaves the flux through it free.
        geometry: { edges: { left: OUTLET, right: OUTLET, top: OUTLET, bottom: OUTLET } },
        inlet: { speed: 0 },
        charges: [
            { x: 0.35, y: 0.5, radius: 0.04, density: 50 },
            { x: 0.5, y: 0.5, radius: 0.04, density: -50 },
        ],
        coefficients: {
            inversePermittivity: slab,
            viscosity: 0.002,                   // read by nothing; the panel wants a number
        },
        // The potential scale is half the other multipoles', so that the
        // flattening across the slab shows.
        display: {
            potentialScale: 0.05,
            fluxScale: 0.6,
            materials: [
                { label: 'free space', factor: 10, color: [0.93, 0.93, 0.93] },
                { label: 'dielectric', factor: 1,  color: [0.55, 0.76, 0.86] },
            ],
        },
    };
});
