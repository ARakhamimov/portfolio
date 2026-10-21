// heatedMembrane.js, by Allen Rakhamimov.
// Diffusion through a membrane whose diffusivity rises with temperature, past
// a hot spot near the feed face.

'use strict';

caseRegister(() => ({
    id: 'heatedMembrane',
    label: 'Heated membrane',
    view: 'species',
    note: 'A membrane with a hot spot near its feed face, where diffusion is '
        + 'a hundred times faster. The front runs far ahead through the spot '
        + 'and stays bent around it at steady state.',
    system: { physics: 'permeation' },
    solver: { cells: 128, timeStep: 0.05, stepsPerFrame: 2 },
    geometry: { edges: { left: INLET, right: WALL, top: SYMMETRY, bottom: SYMMETRY } },
    inlet: { speed: 0, temperature: 20, species: { speciesA: 1 } },
    wall: { temperature: 20, species: { speciesA: 0 } },
    // D(T) = D0 exp(s (T - T0)), the linearized Arrhenius form a rate takes,
    // with s chosen so that D is a hundred times higher at the heater's target.
    coefficients: {
        viscosity: 0,
        thermalDiffusivity: 0.05,
        massDiffusivity: 0.0005,                     // at the feed temperature, the least
        diffusivityTemperatureSensitivity: 0.0576,   // ln(100) / 80, per degree
    },
    sliders: { massDiffusivity: [6.25e-5, 0.004] },
    feeds: [
        // The hot spot. A spot and not a band: a band across the membrane
        // varies D only along the direction the species travels, and the
        // steady profile would then be the straight line it is with no heater.
        { field: 'temperature', rate: 40, target: 100, ...profileDiskWeight(0.3, 0.5, 0.2) },
        // Loss to the surroundings everywhere, the loss term of a fin, so the
        // spot stays a spot: a cooling length sqrt(alpha / rate) of 0.1.
        { field: 'temperature', rate: 5, target: 20 },
    ],
    // Full color at half the feed, so the faint early front shows.
    display: { speciesScale: { speciesA: 0.5 } },
}));
