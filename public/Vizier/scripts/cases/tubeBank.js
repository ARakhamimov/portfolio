// tubeBank.js, by Allen Rakhamimov.
// Eight large tubes in a channel, far enough apart for their wakes to roll up.

'use strict';

caseRegister(() => ({
    id: 'tubeBank',
    label: 'Tube bank',
    view: 'species',
    note: 'Eight large tubes three diameters apart, each with room for its '
        + 'wake to roll up. A steady flow keeps the boundary between the feeds '
        + 'on one streamline, so lower the viscosity until the wakes oscillate '
        + 'to fold it.',
    // A tube is 51 cells across at 512, so its wake can be driven hard: the
    // peak-speed Reynolds ceiling grows with a tube's size in cells. Two cycles
    // a frame pay for four times the cells.
    solver: { cells: 512, coarsestCells: 64, cyclesPerFrame: 2 },
    // Columns at x 0.12, 0.40 and 0.68, of three tubes and two. The last tube
    // is 0.27 from the outlet, clear of backflow through it.
    geometry: {
        solidCircles: [
            { x: 0.12, y: 0.200, radius: 0.05 }, { x: 0.12, y: 0.500, radius: 0.05 },
            { x: 0.12, y: 0.800, radius: 0.05 },
            { x: 0.40, y: 0.350, radius: 0.05 }, { x: 0.40, y: 0.650, radius: 0.05 },
            { x: 0.68, y: 0.200, radius: 0.05 }, { x: 0.68, y: 0.500, radius: 0.05 },
            { x: 0.68, y: 0.800, radius: 0.05 },
        ],
    },
    inlet: { speed: 0.5 },
    wall: { temperature: 80 },
    // Inside the window where the wakes oscillate strongly, with margin above
    // about 3e-4, where runs at two cycles blew up.
    coefficients: {
        viscosity: 0.0004,                      // Re 125 on the diameter, 0.1
        massDiffusivity: 0.0004,
    },
    sliders: { viscosity: [5e-5, 0.0032], massDiffusivity: [5e-5, 0.0032] },
    reactions: caseStandardReactions(25),
    defaultReaction: 'massAction',
}));
