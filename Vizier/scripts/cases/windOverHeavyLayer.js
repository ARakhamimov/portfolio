// windOverHeavyLayer.js, by Allen Rakhamimov.
// A light stream blowing over a still, heavier layer: Kelvin-Helmholtz waves
// held down by gravity.

'use strict';

caseRegister(() => ({
    id: 'windOverHeavyLayer',
    label: 'Wind over a heavy layer',
    view: 'species',
    note: 'A light stream (A, red) blows over a still, heavier layer (B, '
        + 'green) in a basin. The shear rolls the interface into waves, and the '
        + 'buoyancy slider sets how flat gravity keeps them. The density '
        + 'difference is small, as the Boussinesq approximation assumes, so '
        + 'this is not air over water.',
    // Heavy B carries the force, and the light stream feels none, so the outlet
    // in it can hold one pressure without fighting a hydrostatic gradient.
    system: { buoyantField: { field: 'speciesB', reference: 0, sign: '+' } },
    // 512 cells and a coarsest level of 32, as the mixing layer has. With no
    // viscosity every advection term is pure upwind and sits in the
    // denominator.
    solver: {
        cells: 512, coarsestCells: 32,
        timeStep: 1 / 120, stepsPerFrame: 2, cyclesPerFrame: 2,
    },
    // y runs down the screen: the stream enters through the upper half of the
    // left edge and leaves through the upper half of the right, over a basin
    // walled below. The top is a slip wall.
    geometry: {
        edges: { left: WALL, right: WALL, top: SYMMETRY, bottom: WALL },
        ports: [
            { edge: 'left', from: 0, to: 0.5, type: INLET, speed: 0.5, feedA: 1, feedB: 0 },
            { edge: 'right', from: 0, to: 0.5, type: OUTLET },
        ],
    },
    inlet: { speed: 0.5, species: { speciesC: 0 } },
    // The interface starts with a small ripple for the shear to grow.
    initial: {
        patches: [
            { field: 'speciesA', value: 1, at: (x, y) => y < 0.5 + 0.004 * Math.sin(12 * Math.PI * x) },
            { field: 'speciesB', value: 1, at: (x, y) => y >= 0.5 + 0.004 * Math.sin(12 * Math.PI * x) },
        ],
    },
    // Zero asks for the Euler equations, as in the mixing layer. A buoyancy of
    // 1 puts the densimetric Froude number U / sqrt(g' H) at 0.7, so the stream
    // cannot shove the layer aside, and a shear layer rolls up until it is
    // about 0.06 thick, where its Richardson number reaches a quarter.
    coefficients: { viscosity: 0, massDiffusivity: 0, buoyancy: 1 },
    sliders: { buoyancy: [0.125, 8] },
    panel: { velocityScale: 0.5, lengthScale: 0.5 },
}));
