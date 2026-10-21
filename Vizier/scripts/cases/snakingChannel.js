// snakingChannel.js, by Allen Rakhamimov.
// A tubular reactor folded into the box, with a heated section for its
// linearized Arrhenius reaction.

'use strict';

caseRegister(() => ({
    id: 'snakingChannel',
    label: 'Snaking channel',
    view: 'species',
    note: 'A tubular reactor folded into the box, fed at the top left and '
        + 'drained at the bottom right, so conversion grows with distance '
        + 'traveled. The corners hold dead zones the flow barely reaches.',
    // The interior is filled solid and the passages carved back out of it. A
    // passage 0.13 wide is a little over four cells on the coarsest level, and
    // a narrower one could close there and leave the coarse grid no path.
    geometry: {
        fillInterior: true,
        carvedBoxes: [
            [0.00, 0.05, 0.82, 0.18],           // in from the left
            [0.69, 0.05, 0.82, 0.56],           // down the right, y running down
            [0.18, 0.43, 0.82, 0.56],           // back across
            [0.18, 0.43, 0.31, 0.95],           // down the left
            [0.18, 0.82, 1.00, 0.95],           // out to the right
        ],
    },
    // The feeds are split across the passage's own opening, y 0.05 to 0.18,
    // and not at the domain's midline, which the opening lies wholly above.
    inlet: {
        speed: 0.3,
        species: {
            speciesA: profileSplit(0, 1, 0.115),
            speciesB: profileSplit(1, 0, 0.115),
            speciesC: 0,
        },
    },
    coefficients: {
        viscosity: 0.001,                       // Re 39 on the passage width
        massDiffusivity: 0.001,
    },
    sliders: { viscosity: [0.000125, 0.008], massDiffusivity: [0.000125, 0.008] },
    panel: { lengthScale: 0.13 },               // the passage width
    // The long path mixes the feeds before they reach the heater, so a
    // reaction that runs in one place only shows where it runs.
    reactions: [
        ...caseStandardReactions(4, { wall: { temperature: 60 } }),
        {
            name: 'arrhenius',
            label: 'linearized Arrhenius',
            reactionNote: 'Mass action with a rate that rises with temperature, '
                + 'k(T) = k0 exp(s (T - T0)), the Arrhenius law linearized about the '
                + 'opening feed temperature, T0 = 20.',
            // The coupling is the case: the heater lights the reaction, the
            // reaction releases heat, and the heat carries it downstream.
            view: 'temperature',
            note: 'The same channel, but the reaction barely runs at the feed temperature. '
                + 'The two feeds mix along the way and pass through a heated section '
                + 'halfway round, where the rate jumps and the product appears. The feed '
                + 'and heater temperature sliders trade heating the whole stream against '
                + 'heating one section: watch where the product first appears.',
            // The walls are insulated, so heat leaves only with the flow.
            inlet: { temperature: 20 },
            coefficients: {
                thermalDiffusivity: 0.001,      // matched to the mass diffusivity
                // Small enough that the cold reaction is invisible over the
                // whole path, some twenty-five passage widths.
                reactionRate: 0.01,
                heaterTemperature: 80,
                // About 68 kJ/mol near 293 K: a factor of some three hundred
                // between the feed and the heater.
                temperatureSensitivity: 0.095,
                // Enough to carry the reaction past the heater without a
                // runaway at the shipped settings. Raising it finds one.
                heatOfReaction: 15,
            },
            // The heated section is a region feed and not geometry, so the
            // flow passes through it. Its target is a slot, so a slider moves it.
            feeds: [
                { field: 'temperature', rate: 40,
                  target: coefficientSlot('heaterTemperature'),
                  ...profileDiskWeight(0.50, 0.495, 0.06) },
            ],
            sliders: {
                reactionRate: [0.00125, 0.08],
                temperatureSensitivity: [0.011875, 0.76],
                heatOfReaction: [1.875, 120],
                thermalDiffusivity: [0.000125, 0.008],
                inletTemperature: [0, 100],
                heaterTemperature: [0, 100],
            },
        },
    ],
    defaultReaction: 'massAction',
}));
