// compositeWall.js, by Allen Rakhamimov.
// Conduction across brick, insulation and steel, with a bolt through the
// insulation.

'use strict';

caseRegister(() => ({
    id: 'compositeWall',
    label: 'Composite wall',
    view: 'temperature',
    note: 'A wall of brick, insulation and steel, hot on the left and cold on '
        + 'the right. The temperature drops most steeply across the insulation, '
        + 'and the steel bolt through it carries heat across as a thermal '
        + 'bridge.',
    system: { physics: 'conduction' },
    solver: { cells: 128, timeStep: 0.02, stepsPerFrame: 2 },
    // Top and bottom are symmetry edges, so away from the bolt the heat crosses
    // the layers in series.
    geometry: { edges: { left: INLET, right: WALL, top: SYMMETRY, bottom: SYMMETRY } },
    inlet: { speed: 0, temperature: 100 },
    wall: { temperature: 0 },
    initial: { temperature: 0 },
    // The insulation holds the declared diffusivity, the least the wall has,
    // and each other layer multiplies it. The layers share one heat capacity,
    // so the diffusivity ratios are the conductivity ratios.
    coefficients: {
        viscosity: 0,
        thermalDiffusivity: 0.005,              // insulation, domain units^2 per s
        thermalDiffusivityProfile: profileLayers([
            { factor: 8,  rect: [0, 0, 0.375, 1] },                // brick
            { factor: 40, rect: [0.625, 0, 1, 1] },                // steel
            { factor: 40, rect: [0.375, 0.4375, 0.625, 0.5625] },  // the bolt
        ]),
    },
    display: {
        materials: [
            { label: 'insulation', factor: 1,  color: [0.95, 0.84, 0.45] },
            { label: 'brick',      factor: 8,  color: [0.70, 0.30, 0.22] },
            { label: 'steel',      factor: 40, color: [0.56, 0.59, 0.63] },
        ],
    },
}));
