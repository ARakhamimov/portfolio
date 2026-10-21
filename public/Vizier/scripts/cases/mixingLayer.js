// mixingLayer.js, by Allen Rakhamimov.
// A fast stream over a slow one with no viscosity asked for: the Euler
// equations, and the Kelvin-Helmholtz instability.

'use strict';

caseRegister(() => ({
    id: 'mixingLayer',
    label: 'Mixing layer',
    view: 'species',
    note: 'A fast stream (A, top) slides over a slow one (B, bottom) with '
        + 'zero viscosity requested, and the shear rolls up into vortices. The '
        + 'mesh still smears the flow at the scale of a cell, and the panel '
        + 'shows how much viscosity that amounts to.',
    // 512 cells, so the layer starts thin enough to roll up inside the box,
    // and a coarsest level of 32: at 64 the impulsive start rings between
    // inlet and outlet for seconds.
    // With no viscosity every advection term is pure upwind and sits in the
    // denominator, so nothing explicit limits the step.
    solver: {
        cells: 512, coarsestCells: 32,
        timeStep: 1 / 120, stepsPerFrame: 2, cyclesPerFrame: 2,
    },
    // Symmetry edges are slip walls.
    geometry: { edges: { left: INLET, right: OUTLET, top: SYMMETRY, bottom: SYMMETRY } },
    // y runs down the screen: the top half is the fast stream. The speeds set
    // only how fast the run plays.
    inlet: {
        speed: 0.5,
        velocityX: profileSplit(0.5, 0.2),
        species: { speciesA: profileSplit(1, 0), speciesB: profileSplit(0, 1), speciesC: 0 },
    },
    // Zero asks for the Euler equations: the diffusion terms are left out, and
    // the blend runs pure upwind wherever there is flow.
    coefficients: { viscosity: 0, massDiffusivity: 0 },
    panel: { velocityScale: 0.5, lengthScale: 1 },
    reactions: caseStandardReactions(2.5),
    defaultReaction: 'none',
}));
