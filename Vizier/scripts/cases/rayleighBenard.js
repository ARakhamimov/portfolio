// rayleighBenard.js, by Allen Rakhamimov.
// Convection in a square box heated from below, at a Rayleigh number where
// the flow is unsteady.

'use strict';

caseRegister(() => ({
    id: 'rayleighBenard',
    label: 'Rayleigh-Bénard',
    view: 'temperature',
    note: 'A closed box heated from below and cooled from above. Plumes rise '
        + 'and fall, feeding one large tilted roll and two small corner rolls. '
        + 'Lower the buoyancy and the motion calms toward steady rolls.',
    system: {
        transportsSpecies: false,
        buoyantField: { field: 'temperature', reference: 50, sign: '-' },
    },
    solver: { stepsPerFrame: 2 },
    geometry: { edges: { left: WALL, right: WALL, top: INLET, bottom: INLET } },
    // y runs down the screen: the top half cold, the bottom hot.
    inlet: { speed: 0, temperature: profileSplit(0, 100) },
    // A faint warm strip on the left of the floor breaks the box's mirror
    // symmetry, so the first plume does not wait on rounding.
    initial: {
        temperature: 50,
        patches: [{ field: 'temperature', value: 55,
            at: (x, y) => x > 0.15 && x < 0.35 && y > 0.95 }],
    },
    // Free-fall scaling: buoyancy times the temperature difference times the
    // box makes the free-fall speed one, and then nu = kappa = sqrt(Pr / Ra).
    coefficients: {
        viscosity: 3.16e-4,                     // sqrt(Pr / Ra), Pr 1, Ra 1e7
        thermalDiffusivity: 3.16e-4,
        buoyancy: 0.01,                         // free-fall speed 1 over 100 degrees
    },
    sliders: { viscosity: [3.95e-5, 0.002528], buoyancy: [0.00125, 0.08] },
    // The free-fall speed, so the panel's Reynolds number is sqrt(Ra / Pr).
    panel: { temperatureDifference: 100, velocityScale: 1, lengthScale: 1,
        heatFluxWalls: { hot: 'bottom', cold: 'top' } },
}));
