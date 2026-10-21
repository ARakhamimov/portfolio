// rayleighTaylor.js, by Allen Rakhamimov.
// Heavy fluid over light in a closed box, the Rayleigh-Taylor instability.

'use strict';

caseRegister(() => ({
    id: 'rayleighTaylor',
    label: 'Rayleigh-Taylor',
    view: 'species',
    note: 'Heavy fluid (A, red) rests on light fluid (B, green). A small '
        + 'ripple in the interface grows into falling fingers and rising '
        + 'bubbles that roll up into mushroom shapes.',
    // Species A carries the density; B only marks the light fluid.
    system: { buoyantField: { field: 'speciesA', reference: 0.5, sign: '+' } },
    geometry: { edges: { left: WALL, right: WALL, top: WALL, bottom: WALL } },
    inlet: { speed: 0, species: {} },
    // The interface starts as one cosine, whose slope is zero at both side walls.
    initial: {
        patches: [
            { field: 'speciesA', value: 1,
              at: (x, y) => y < 0.5 + 0.02 * Math.cos(2 * Math.PI * x) },
            { field: 'speciesB', value: 1,
              at: (x, y) => y >= 0.5 + 0.02 * Math.cos(2 * Math.PI * x) },
        ],
    },
    // Speeds near one, a momentum cell Peclet number near 2 at 256
    // cells, and a thin interface.
    coefficients: { viscosity: 0.002, massDiffusivity: 0.001, buoyancy: 2 },
    sliders: {
        viscosity: [0.00025, 0.016],
        massDiffusivity: [0.000125, 0.008],
        buoyancy: [0.25, 16],
    },
    panel: { velocityScale: 1, lengthScale: 1 },
}));
