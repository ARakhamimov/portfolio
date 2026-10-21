// tunnelingBarrier.js, by Allen Rakhamimov.
// A wave packet against a potential barrier higher than its energy.

'use strict';

caseRegister(() => ({
    id: 'tunnelingBarrier',
    label: 'Tunneling through a barrier',
    view: 'probability density',
    note: 'A wave packet meets a thin band where the potential energy is '
        + 'higher than its own. A classical particle would bounce back, but '
        + 'part of the wave passes through. The potential height slider sets '
        + 'how much.',
    system: { physics: 'schrodinger' },
    // The step is held near h^2 by the coupling between the two parts, whatever
    // theta is: 0.4 h^2 at 256 cells.
    solver: { cells: 256, coarsestCells: 64, timeStep: 0.4 / 65536, stepsPerFrame: 5, cyclesPerFrame: 2,
        timeStepScaling: 'spacingSquared' },
    geometry: { edges: { left: WALL, right: WALL, top: WALL, bottom: WALL } },
    inlet: { speed: 0 },
    initial: { packets: [{ x: 0.25, y: 0.5, width: 0.08, kx: 100, ky: 0 }] },
    coefficients: {
        viscosity: 0,
        // 1.15 times the packet's energy k^2 / 2 = 5000, over a band 0.035
        // wide, a little over two cells of the coarsest level.
        potentialHeight: 5750,
        potentialShape: positionProfile('select(0.0, 1.0, position.x > 0.4825 && position.x < 0.5175)'),
    },
    sliders: { potentialHeight: [718.75, 46000] },
    display: { waveScale: 0.5 },
}));
