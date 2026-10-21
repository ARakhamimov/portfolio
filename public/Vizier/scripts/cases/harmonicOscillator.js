// harmonicOscillator.js, by Allen Rakhamimov.
// A coherent state circling in a two-dimensional harmonic well.

'use strict';

caseRegister(() => ({
    id: 'harmonicOscillator',
    label: 'Harmonic oscillator',
    view: 'wave function',
    note: 'A wave packet in a bowl-shaped potential, started off center and '
        + 'moving sideways. It circles the center without spreading, because '
        + 'its width matches the oscillator\'s ground state. The potential '
        + 'height slider stiffens the bowl.',
    system: { physics: 'schrodinger' },
    // 0.3 h^2 here, below the slit cases' 0.4, since the potential adds to the
    // coupling the step is limited by.
    solver: { cells: 256, coarsestCells: 64, timeStep: 0.3 / 65536, stepsPerFrame: 8, cyclesPerFrame: 2,
        timeStepScaling: 'spacingSquared' },
    geometry: { edges: { left: WALL, right: WALL, top: WALL, bottom: WALL } },
    inlet: { speed: 0 },
    // V = (1/2) omega^2 r^2 with omega = 300, written as V0 w with w = 4 r^2,
    // one at the middle of each edge. The ground state is 1 / sqrt(omega)
    // wide, and the packet's sideways wavenumber omega times its offset sends
    // it round a circle.
    initial: { packets: [{ x: 0.25, y: 0.5, width: 1 / Math.sqrt(300), kx: 0, ky: 300 * 0.25 }] },
    coefficients: {
        viscosity: 0,
        potentialHeight: 300 * 300 / 8,
        potentialShape: positionProfile(
            '4.0 * ((position.x - 0.5) * (position.x - 0.5) + (position.y - 0.5) * (position.y - 0.5))'),
    },
    sliders: { potentialHeight: [1406.25, 90000] },
    display: { waveScale: 0.8 },
}));
