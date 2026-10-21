// tubeBankOffsetJets.js, by Allen Rakhamimov.
// The offset jets with a cluster of tubes at each jet mouth. One of a pair
// with offsetJets; only the obstacles differ.

'use strict';

caseRegister(() => ({
    id: 'tubeBankOffsetJets',
    label: 'Tube bank fed by offset jets',
    view: 'species',
    note: 'The offset jets with a cluster of small tubes at each jet mouth. '
        + 'Each jet leaves its cluster as several narrower jets, which collide '
        + 'in the open middle.',
    // The tube bank's mesh and hierarchy, because these are its tubes.
    solver: { cells: 512, coarsestCells: 64, cyclesPerFrame: 2 },
    // Two staggered columns at each jet mouth, the first spanning the jet band.
    // A deeper cluster turns more of its jet aside toward the outlets.
    geometry: {
        edges: { left: INLET, right: INLET, top: OUTLET, bottom: OUTLET },
        solidCircles: [
            { x: 0.10, y: 0.440, radius: 0.025 }, { x: 0.10, y: 0.540, radius: 0.025 },
            { x: 0.10, y: 0.640, radius: 0.025 },
            { x: 0.18, y: 0.490, radius: 0.025 }, { x: 0.18, y: 0.590, radius: 0.025 },
            { x: 0.82, y: 0.410, radius: 0.025 }, { x: 0.82, y: 0.510, radius: 0.025 },
            { x: 0.90, y: 0.360, radius: 0.025 }, { x: 0.90, y: 0.460, radius: 0.025 },
            { x: 0.90, y: 0.560, radius: 0.025 },
        ],
    },
    inlet: {
        speed: 0.5,
        velocityX: profileOffsetJets(0.5, 0.46, 0.62, 0.38, 0.54),
        species: {
            speciesA: profileJetSpecies(1, 0, 0.46, 0.62, 0.38, 0.54),
            speciesB: profileJetSpecies(0, 1, 0.46, 0.62, 0.38, 0.54),
            speciesC: 0,
        },
    },
    // Half the offset jets' coefficients for half their cell size, so the jets
    // sit at the same fraction of the mesh ceiling.
    coefficients: { viscosity: 0.00105, massDiffusivity: 0.0007 },
    sliders: { viscosity: [0.00013125, 0.0084], massDiffusivity: [8.75e-5, 0.0056] },
    panel: { velocityScale: 0.5, lengthScale: 0.16 },
    reactions: caseStandardReactions(20),
    defaultReaction: 'massAction',
}));
