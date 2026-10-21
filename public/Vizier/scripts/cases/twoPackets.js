// twoPackets.js, by Allen Rakhamimov.
// Two wave packets crossing in a box: a superposition, and its interference.

'use strict';

caseRegister(() => ({
    id: 'twoPackets',
    label: 'Two packets',
    view: 'probability density',
    note: 'Two wave packets cross in a closed box. Where they overlap the '
        + 'density shows fringes that neither has alone, and once apart each '
        + 'carries on unchanged.',
    system: { physics: 'schrodinger' },
    // The step is held near h^2 by the coupling between the two parts, whatever
    // theta is: 0.4 h^2 at 256 cells.
    solver: { cells: 256, coarsestCells: 64, timeStep: 0.4 / 65536, stepsPerFrame: 5, cyclesPerFrame: 2,
        timeStepScaling: 'spacingSquared' },
    geometry: { edges: { left: WALL, right: WALL, top: WALL, bottom: WALL } },
    inlet: { speed: 0 },
    // Each aimed 30 degrees off the horizontal, so they meet in the middle of
    // the box; |k| = 100 is 16 cells per wavelength.
    initial: {
        packets: [
            { x: 0.25, y: 0.35, width: 0.07, kx: 100 * Math.cos(Math.PI / 6), ky: 100 * Math.sin(Math.PI / 6) },
            { x: 0.25, y: 0.65, width: 0.07, kx: 100 * Math.cos(Math.PI / 6), ky: -100 * Math.sin(Math.PI / 6) },
        ],
    },
    coefficients: { viscosity: 0 },
    // Two packets of one overlap to a peak of two.
    display: { waveScale: 1 },
}));
