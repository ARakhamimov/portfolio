// magneticShield.js, by Allen Rakhamimov.
// A uniform magnetic field diverted around the space inside a permeable ring.

'use strict';

caseRegister(() => {
    // A ring thirty times more permeable than the space inside and outside it:
    // 1/mu is the ring's own 1/30, lifted to one elsewhere.
    const radius = profileDistance(0.5, 0.5);
    const ring = coefficientProfile(1 / 30,
        positionProfile(`select(30.0, 1.0, ${radius} > 0.18 && ${radius} < 0.25)`));
    return {
        id: 'magneticShield',
        label: 'Magnetic shield',
        view: 'potential',
        note: 'A uniform magnetic field crosses a ring thirty times more '
            + 'permeable than its surroundings. The field crowds into the ring '
            + 'and leaves the space inside shielded. Iron is thousands of times '
            + 'more permeable; at this contrast the solver converges only up to '
            + '128 cells.',
        system: { physics: 'magnetostatics' },
        // 128 cells: at a contrast of thirty the cycle diverges at 256 whatever
        // the coarsest level, since the coarse correction is what fails.
        solver: { cells: 128, coarsestCells: 16, timeStep: 1 / 60, stepsPerFrame: 1, cyclesPerFrame: 3 },
        // The field enters normal to the left and right edges and runs parallel
        // to the top and bottom.
        geometry: { edges: { left: INLET, right: INLET, top: SYMMETRY, bottom: SYMMETRY } },
        inlet: { speed: 0, flux: 1 },
        coefficients: {
            inversePermeability: ring,
            viscosity: 0.002,                   // read by nothing; the panel wants a number
        },
        // The potential spans about +-0.38, and the field crowds into
        // the ring at a few times the inlet's.
        display: {
            potentialScale: 0.4,
            fluxScale: 2,
            materials: [
                { label: 'free space',     factor: 30, color: [0.93, 0.93, 0.93] },
                { label: 'permeable ring', factor: 1,  color: [0.45, 0.46, 0.50] },
            ],
        },
    };
});
