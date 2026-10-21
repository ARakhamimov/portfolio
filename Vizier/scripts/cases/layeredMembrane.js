// layeredMembrane.js, by Allen Rakhamimov.
// Diffusion through an asymmetric membrane, a dense skin on a porous support,
// with a pinhole in the skin.

'use strict';

caseRegister(() => ({
    id: 'layeredMembrane',
    label: 'Layered membrane',
    view: 'species',
    note: 'A dense skin on a porous support, fed on the left and swept clean '
        + 'on the right. Almost the whole concentration drop sits across the '
        + 'skin, and the pinhole in it lets the feed straight through.',
    system: { physics: 'permeation' },
    solver: { cells: 128, timeStep: 0.02, stepsPerFrame: 2 },
    geometry: { edges: { left: INLET, right: WALL, top: SYMMETRY, bottom: SYMMETRY } },
    inlet: { speed: 0, species: { speciesA: 1 } },
    // The permeate face is swept clean. There is no partition coefficient, so
    // the concentration is continuous across every interface.
    wall: { species: { speciesA: 0 } },
    // The skin holds the declared diffusivity, and the other layers multiply it.
    coefficients: {
        viscosity: 0,
        massDiffusivity: 0.001,                 // the skin, domain units^2 per s
        massDiffusivityProfile: profileLayers([
            { factor: 30, rect: [0, 0, 0.375, 1] },                    // feed-side liquid
            { factor: 15, rect: [0.4375, 0, 1, 1] },                   // porous support
            { factor: 30, rect: [0.375, 0.4375, 0.4375, 0.5625] },     // the pinhole
        ]),
    },
    sliders: { massDiffusivity: [0.000125, 0.008] },
    // The pinhole is open to the feed liquid, so it is drawn as that material.
    display: {
        materials: [
            { label: 'dense skin',     factor: 1,  color: [0.27, 0.27, 0.32] },
            { label: 'porous support', factor: 15, color: [0.86, 0.82, 0.72] },
            { label: 'feed liquid',    factor: 30, color: [0.62, 0.79, 0.90] },
        ],
    },
}));
