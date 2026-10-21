// patternGrayScott.js, by Allen Rakhamimov.
// Gray and Scott's autocatalytic reaction with diffusion: two species, no
// flow, rotating spiral waves.

'use strict';

caseRegister(() => ({
    id: 'patternGrayScott',
    label: 'Pattern: Gray-Scott',
    view: 'species',
    note: 'Two species with no flow. B feeds on A and makes more of itself '
        + 'while a feed replaces A, so the fronts curl into spirals that keep '
        + 'turning. Use the species buttons to watch B alone.',
    system: { physics: 'reactionDiffusion', speciesBOrder: 2 },
    // A quarter of the usual step, four times a frame, so the clock runs at the
    // usual rate and the autocatalytic source, kept in the numerator, gets a
    // step it can hold.
    solver: { timeStep: 1 / 240, stepsPerFrame: 4 },
    geometry: { edges: { left: WALL, right: WALL, top: WALL, bottom: WALL } },
    inlet: { speed: 0 },
    // The uniform state is a fixed point. Two seeds of V break it: one would
    // spread as a symmetric ring, while two rings collide and break each
    // other's front, and a broken front curls into a spiral.
    initial: {
        patches: [
            { field: 'speciesA', value: 1 },
            { field: 'speciesB', value: 0 },
            { field: 'speciesA', value: 0.5, at: profileDiskWeight(0.42, 0.55, 0.03).at },
            { field: 'speciesB', value: 0.25, at: profileDiskWeight(0.42, 0.55, 0.03).at },
            { field: 'speciesA', value: 0.5, at: profileDiskWeight(0.58, 0.46, 0.02).at },
            { field: 'speciesB', value: 0.25, at: profileDiskWeight(0.58, 0.46, 0.02).at },
        ],
    },
    // Gray and Scott's constants with every rate and both diffusivities scaled
    // by 200, an exact change of clock, so reactionRate is that factor. F 0.018
    // and k 0.051 is the spiral region of Pearson's (1993) parameter plane, and
    // a feature is about a twentieth of the box.
    coefficients: {
        reactionRate: 200,
        feedRate: 3.6,                          // F = 0.018
        killRate: 10.2,                         // k = 0.051
        massDiffusivity: 0.0007,                // U, the substrate
        speciesBDiffusivity: 0.00035,           // V, and the ratio makes the pattern
        viscosity: 0.002,                       // read by nothing; the panel wants a number
    },
    sliders: {
        massDiffusivity: [8.75e-5, 0.0056],
        speciesBDiffusivity: [4.375e-5, 0.0028],
        reactionRate: [25, 1600],
        feedRate: [0.45, 28.8],
        killRate: [1.275, 81.6],
    },
}));
