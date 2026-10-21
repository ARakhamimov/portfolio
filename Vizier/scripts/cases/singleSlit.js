// singleSlit.js, by Allen Rakhamimov.
// A wave packet through one slit narrower than its wavelength.

'use strict';

caseRegister(() => ({
    id: 'singleSlit',
    label: 'Single slit',
    view: 'wave function',
    note: 'A wave packet aimed at a wall with one slit narrower than its '
        + 'wavelength. Most of it reflects, and what passes spreads from the '
        + 'slit in a half circle. The probability density view shows where the '
        + 'particle is likely to be.',
    system: { physics: 'schrodinger' },
    // The step is held near h^2 by the coupling between the two parts, whatever
    // theta is: 0.4 h^2 at 256 cells.
    solver: { cells: 256, coarsestCells: 64, timeStep: 0.4 / 65536, stepsPerFrame: 5, cyclesPerFrame: 2,
        timeStepScaling: 'spacingSquared' },
    geometry: {
        edges: { left: WALL, right: WALL, top: WALL, bottom: WALL },
        // A barrier with a slit 0.04 wide, over two cells of the coarsest level.
        solidBoxes: [[0.47, 0, 0.53, 0.48], [0.47, 0.52, 0.53, 1]],
    },
    inlet: { speed: 0 },
    initial: { packets: [{ x: 0.2, y: 0.5, width: 0.08, kx: 100, ky: 0 }] },
    coefficients: { viscosity: 0 },
    // The packet starts at one, and what passes the slit is a few tenths.
    display: { waveScale: 0.5 },
}));
