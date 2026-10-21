// heatedCavity.js, by Allen Rakhamimov.
// Natural convection in a square box of air heated from the side, after de
// Vahl Davis (1983).

'use strict';

caseRegister(() => ({
    id: 'heatedCavity',
    label: 'Heated cavity',
    // Vorticity, since the temperature settles into tilted bands that change
    // little while the cell splits and crowds into wall layers.
    view: 'vorticity',
    note: 'A closed box of air, hot on the left and cold on the right. Warm '
        + 'air rises along the hot wall, sinks along the cold one, and settles '
        + 'to a steady flow. Raise the buoyancy and the flow crowds into thin '
        + 'layers at the walls.',
    // y runs down the screen, so a hot parcel's buoyancy carries a minus sign.
    system: {
        transportsSpecies: false,
        buoyantField: { field: 'temperature', reference: 50, sign: '-' },
    },
    solver: { stepsPerFrame: 2 },
    // Both side edges are INLET at zero speed: the boundary table is keyed on
    // type, every WALL shares one temperature, and one profile in x gives each
    // side its own.
    geometry: { edges: { left: INLET, right: INLET, top: WALL, bottom: WALL } },
    inlet: { speed: 0, temperature: profileSplitX(100, 0) },
    initial: { temperature: 50 },
    // Air, Pr 0.71, sized from de Vahl Davis's Table V so that the peak
    // vertical speed is about 1 at Ra 1e5.
    coefficients: {
        viscosity: 0.0104,                      // Pr 0.71
        thermalDiffusivity: 0.0146,             // 1 / 68.59
        buoyancy: 0.151,                        // Ra 1e5 over a difference of 100 degrees
    },
    sliders: { viscosity: [0.0013, 0.0832], buoyancy: [0.018875, 1.208] },
    panel: { temperatureDifference: 100, velocityScale: 1, lengthScale: 1,
        heatFluxWalls: { hot: 'left', cold: 'right' } },
}));
