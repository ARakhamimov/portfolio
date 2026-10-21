// packedBedFouled.js, by Allen Rakhamimov.
// The packed bed with a patch of the packing plugged, so the feed channels
// around it.

'use strict';

caseRegister(() => ({
    id: 'packedBedFouled',
    label: 'Fouled packed bed',
    // The bypass is the lesson, and the species front its consequence.
    view: 'velocity',
    note: 'The packed bed with a patch of packing plugged. The feed channels '
        + 'around the patch, and that part of the bed converts nothing. The '
        + 'only change from the packed bed is a drag that is no longer uniform.',
    system: { porous: 'brinkman' },
    inlet: { speed: 0.5 },
    wall: { temperature: 80 },
    coefficients: {
        viscosity: 0.002,
        permeability: 0.0016,
        // The drag is 25 times higher in the patch. A larger factor makes the
        // bypass plainer but thins the Brinkman layer inside it, sqrt(K / 25),
        // already two cells at 256. The patch runs along the top wall and is
        // nine coarse cells by eight at 32.
        fouledPatch: { factor: 25, rect: [0.20, 0.0, 0.75, 0.50] },
        massDiffusivity: 0.0012,
    },
    sliders: {
        viscosity: [0.00025, 0.016],
        permeability: [0.0002, 0.0128],
        massDiffusivity: [0.00015, 0.0096],
    },
    display: {
        materials: [
            { label: 'open bed', factor: 1,  color: [0.82, 0.72, 0.52] },
            { label: 'fouled',   factor: 25, color: [0.42, 0.34, 0.22] },
        ],
    },
    panel: { velocityScale: 0.5, lengthScale: 1 },
    reactions: caseStandardReactions(4),
    defaultReaction: 'massAction',
}));
