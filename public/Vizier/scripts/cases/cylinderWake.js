// cylinderWake.js, by Allen Rakhamimov.
// A wake behind one cylinder, where the feeds meet only where the wake folds
// them together.

'use strict';

caseRegister(() => ({
    id: 'cylinderWake',
    label: 'Cylinder wake',
    view: 'species',
    note: 'B enters along the top of the inlet and A along the bottom, and '
        + 'they meet only where the cylinder\'s wake folds them together. With a '
        + 'reaction chosen, the product marks where they mix, and the mixing '
        + 'limits how much converts.',
    // Off the midline, so the wake has an asymmetry to amplify: a problem
    // symmetric about the midline stays symmetric.
    geometry: { solidCircles: [{ x: 0.22, y: 0.515, radius: 0.08 }] },
    inlet: { speed: 0.5, velocityX: profileParabolic(0.5) },      // mean 0.5, peak 0.75
    // Both diffusivities sit high enough at 256 cells to keep the case off the
    // blend, so what the mesh costs is a sharper interface than the flow has.
    coefficients: {
        viscosity: 0.0024,                      // Re 50 on the diameter, 0.16
        massDiffusivity: 0.0019,                // species cell Peclet 1.5
    },
    sliders: { viscosity: [0.0003, 0.0192], massDiffusivity: [0.0002375, 0.0152] },
    reactions: caseStandardReactions(20),       // Da 4.3: mixing limited
    defaultReaction: 'none',
}));
