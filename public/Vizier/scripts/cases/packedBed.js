// packedBed.js, by Allen Rakhamimov.
// The empty channel packed with solid: Brinkman's momentum row in place of
// Navier-Stokes.

'use strict';

caseRegister(() => ({
    id: 'packedBed',
    label: 'Packed bed',
    view: 'species',
    note: 'The empty channel packed full of solid. Drag from the packing '
        + 'outweighs the shear, so the velocity profile is flat and the feeds '
        + 'cross the bed together. Compare the front with the empty channel\'s.',
    // Darcy's drag replaces inertia; Brinkman's shear term keeps a no-slip wall.
    system: { porous: 'brinkman' },
    inlet: { speed: 0.5 },
    wall: { temperature: 80 },
    coefficients: {
        viscosity: 0.002,
        // sqrt(K) = 0.04 is the Brinkman wall layer, ten cells at 256: thin
        // enough to read as a skin on a plug profile, thick enough to resolve.
        permeability: 0.0016,
        massDiffusivity: 0.0012,                // just over the |u|h/2 floor
    },
    sliders: {
        viscosity: [0.00025, 0.016],
        permeability: [0.0002, 0.0128],
        massDiffusivity: [0.00015, 0.0096],
    },
    panel: { velocityScale: 0.5, lengthScale: 1 },              // the bed's length
    reactions: caseStandardReactions(4),
    defaultReaction: 'massAction',
}));
