// sandbox.js, by Allen Rakhamimov.
// The case a viewer builds: ports, shapes and painted materials over a box.

'use strict';

caseRegister(() => ({
    id: 'sandbox',
    label: 'Sandbox',
    view: 'species',
    note: 'A box to build in. Place and carve shapes, paint catalyst or '
        + 'porous medium, and put inlets and outlets anywhere on the edges. It '
        + 'opens as a split feed past one cylinder.',
    // Declaring a ports list, even an empty one, is what feeds the inlets from
    // ports.
    geometry: {
        edges: { left: WALL, right: WALL, top: WALL, bottom: WALL },
        ports: [
            { edge: 'left', from: 0, to: 0.5, type: INLET, speed: 0.5, feedA: 1, feedB: 0 },
            { edge: 'left', from: 0.5, to: 1, type: INLET, speed: 0.5, feedA: 0, feedB: 1 },
            { edge: 'right', from: 0, to: 1, type: OUTLET },
        ],
        shapes: [{ kind: 'circle', x: 0.3, y: 0.5, radius: 0.08, solid: true }],
    },
    inlet: { speed: 0.5, species: { speciesC: 0 } },
    // The cylinder wake's coefficients: Re 50 on this cylinder. Painted porous
    // medium lets about a fifth of the flow seep through a bed in its way at
    // x1 and a thirtieth at x8, at 64 cells.
    coefficients: {
        viscosity: 0.0024,
        massDiffusivity: 0.0019,
        porousPermeability: 5e-5,
    },
    sliders: {
        viscosity: [0.0003, 0.0192],
        massDiffusivity: [0.0002375, 0.0152],
        porousPermeability: [6.25e-6, 0.0004],
    },
    paintable: true,
    // Each painted material runs from its weakest strength to its darkest.
    // The colors: a slate for a catalyst, the packed beds' sand for a
    // porous medium.
    display: {
        materials: [
            { label: 'open fluid', color: [1.00, 1.00, 1.00] },
            { label: 'catalyst', paint: 'catalyst', color: [0.66, 0.80, 0.86], dark: [0.12, 0.32, 0.42] },
            { label: 'porous', paint: 'porous', color: [0.86, 0.78, 0.60], dark: [0.42, 0.34, 0.22] },
        ],
    },
    // A layout a viewer draws has no one diameter, so the panel's Reynolds
    // number is built on the box.
    panel: { lengthScale: 1 },
    // On catalyst a reaction runs ten times as fast as on bare fluid.
    reactions: caseStandardReactions(20).map((reaction) => ({
        ...reaction,
        coefficients: {
            ...reaction.coefficients,
            paintedReactionRate: 10 * reaction.coefficients.reactionRate,
        },
        sliders: reaction.coefficients.reactionRate > 0
            ? { ...reaction.sliders, paintedReactionRate: reaction.sliders.reactionRate.map((end) => 10 * end) }
            : reaction.sliders,
    })),
    defaultReaction: 'none',
}));
