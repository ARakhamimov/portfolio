// selectivityReactor.js, by Allen Rakhamimov.
// A premixed feed past cooling tubes, reacting two ways at two activation
// energies.

'use strict';

caseRegister(() => ({
    id: 'selectivityReactor',
    label: 'Selectivity reactor',
    view: 'species',
    note: 'A premixed feed of A and B flows past cooling tubes and reacts two '
        + 'ways, to C and to D, and D speeds up far more with temperature. Warm '
        + 'the coolant and more feed converts, with D forming where the stream '
        + 'runs hottest. Warm the feed and D forms right at the inlet.',
    // Four staggered columns. The smallest gap is nearly four coarse cells, and
    // the last tube is 0.30 from the outlet, clear of backflow through it.
    geometry: {
        solidCircles: [
            { x: 0.18, y: 0.2, radius: 0.04 }, { x: 0.18, y: 0.4, radius: 0.04 },
            { x: 0.18, y: 0.6, radius: 0.04 }, { x: 0.18, y: 0.8, radius: 0.04 },
            { x: 0.34, y: 0.3, radius: 0.04 }, { x: 0.34, y: 0.5, radius: 0.04 },
            { x: 0.34, y: 0.7, radius: 0.04 },
            { x: 0.50, y: 0.2, radius: 0.04 }, { x: 0.50, y: 0.4, radius: 0.04 },
            { x: 0.50, y: 0.6, radius: 0.04 }, { x: 0.50, y: 0.8, radius: 0.04 },
            { x: 0.66, y: 0.3, radius: 0.04 }, { x: 0.66, y: 0.5, radius: 0.04 },
            { x: 0.66, y: 0.7, radius: 0.04 },
        ],
    },
    // Premixed on purpose, so the case is about temperature and not mixing.
    inlet: { speed: 0.3, temperature: 40, species: { speciesA: 1, speciesB: 1, speciesC: 0, speciesD: 0 } },
    // Every solid surface is the jacket: walls and tubes share one temperature.
    wall: { temperature: 40 },
    // Both reactions are linearized about the opening feed, 40 degrees; the two
    // sensitivities stand for about 65 and 150 kJ/mol near 313 K, chosen
    // against a cooled plug-flow model and not in this geometry.
    coefficients: {
        viscosity: 0.002,                       // Re 12 on one tube
        massDiffusivity: 0.001,
        thermalDiffusivity: 0.02,               // well above |u|h/2, so the cooling reaches in
        reactionRate: 0.4,
        temperatureSensitivity: 0.08,
        heatOfReaction: 20,
        sideReactionRate: 0.016,
        sideTemperatureSensitivity: 0.18,
        sideHeatOfReaction: 30,
    },
    sliders: {
        viscosity: [0.00025, 0.016],
        massDiffusivity: [0.000125, 0.008],
        reactionRate: [0.05, 3.2],
        temperatureSensitivity: [0.01, 0.64],
        heatOfReaction: [2.5, 160],
        sideReactionRate: [0.002, 0.128],
        sideTemperatureSensitivity: [0.0225, 1.44],
        sideHeatOfReaction: [3.75, 240],
        thermalDiffusivity: [0.0025, 0.16],
        inletTemperature: [0, 100],
        wallTemperature: [0, 100],
    },
    // The reactor's length, since the Damkohler number that matters is the
    // residence time through all of it.
    panel: { lengthScale: 1 },
}));
