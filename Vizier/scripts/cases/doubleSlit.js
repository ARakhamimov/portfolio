// doubleSlit.js, by Allen Rakhamimov.
// A wave packet through two slits, interfering with itself.

'use strict';

caseRegister(() => ({
    id: 'doubleSlit',
    label: 'Double slit',
    view: 'probability density',
    note: 'A wave packet aimed at a wall with two slits. The waves from the '
        + 'two slits interfere beyond the wall, so the particle is found along '
        + 'bright fans and never on the dark lines between them.',
    system: { physics: 'schrodinger' },
    // The step is held near h^2 by the coupling between the two parts, whatever
    // theta is: 0.4 h^2 at 256 cells.
    solver: { cells: 256, coarsestCells: 64, timeStep: 0.4 / 65536, stepsPerFrame: 5, cyclesPerFrame: 2,
        timeStepScaling: 'spacingSquared' },
    geometry: {
        edges: { left: WALL, right: WALL, top: WALL, bottom: WALL },
        // Two slits 0.04 wide, 0.14 apart center to center.
        solidBoxes: [[0.47, 0, 0.53, 0.41], [0.47, 0.45, 0.53, 0.55], [0.47, 0.59, 0.53, 1]],
    },
    inlet: { speed: 0 },
    initial: { packets: [{ x: 0.2, y: 0.5, width: 0.08, kx: 150, ky: 0 }] },
    coefficients: { viscosity: 0 },
    // The packet starts at one, and what passes the slits is a few tenths.
    display: { waveScale: 0.4 },
}));
