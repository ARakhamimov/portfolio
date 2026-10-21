// dielectricLens.js, by Allen Rakhamimov.
// A uniform electric field bent by a biconvex dielectric lens.

'use strict';

caseRegister(() => {
    // The overlap of two disks, 0.24 thick and 0.48 tall, ten times the
    // permittivity around it: 1/eps is the lens's own 1/10, lifted to one
    // outside. Only its tips are under two cells of the coarsest level.
    const lens = coefficientProfile(0.1, positionProfile(
        `select(10.0, 1.0, ${profileDistance(0.32, 0.5)} < 0.3 && ${profileDistance(0.68, 0.5)} < 0.3)`));
    return {
        id: 'dielectricLens',
        label: 'Dielectric lens',
        view: 'potential',
        note: 'A uniform electric field crosses a lens ten times more '
            + 'polarizable than its surroundings. The field bends at both faces '
            + 'and the equipotentials spread apart inside the lens. This is '
            + 'refraction of a static field, not focusing of light.',
        system: { physics: 'electrostatics' },
        // 128 cells, as the shield runs.
        solver: { cells: 128, coarsestCells: 16, timeStep: 1 / 60, stepsPerFrame: 1, cyclesPerFrame: 3 },
        // The field enters normal to the left and right edges and runs parallel
        // to the top and bottom.
        geometry: { edges: { left: INLET, right: INLET, top: SYMMETRY, bottom: SYMMETRY } },
        inlet: { speed: 0, flux: 1 },
        coefficients: {
            inversePermittivity: lens,
            viscosity: 0.002,                   // read by nothing; the panel wants a number
        },
        // A unit field across the box spans about +-0.5, and the
        // displacement inside the lens rises to a few times the inlet's.
        display: {
            potentialScale: 0.5,
            fluxScale: 2,
            materials: [
                { label: 'free space', factor: 10, color: [0.93, 0.93, 0.93] },
                { label: 'dielectric', factor: 1,  color: [0.55, 0.76, 0.86] },
            ],
        },
    };
});
