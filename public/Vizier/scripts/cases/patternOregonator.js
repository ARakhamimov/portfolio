// patternOregonator.js, by Allen Rakhamimov.
// Field and Noyes's Oregonator, a model of the Belousov-Zhabotinsky reaction:
// three species, no flow, one spiral.

'use strict';

caseRegister(() => ({
    id: 'patternOregonator',
    label: 'Pattern: Oregonator',
    view: 'species',
    note: 'A model of the Belousov-Zhabotinsky reaction with no flow. A '
        + 'broken front of HBrO2 (red) curls into a spiral, followed by Ce(IV) '
        + '(blue), which keeps the medium from firing again, and then bromide '
        + '(green) as it recovers.',
    system: { physics: 'oregonator' },
    // 0.375 model seconds a frame. The front speed is within about 8% of its
    // converged value at this step.
    solver: { timeStep: 0.125, stepsPerFrame: 3, cyclesPerFrame: 2 },
    geometry: { edges: { left: WALL, right: WALL, top: WALL, bottom: WALL } },
    inlet: { speed: 0 },
    // The rest state at these constants, from integrating the model to a steady
    // state, then the broken front laid out in front widths.
    initial: {
        patches: profileOregonatorSeed(
            { X: 7.4654e-5, Y: 1.46993e-3, Z: 3.01005e-3, peak: 2.8 },
            Math.sqrt(3.08e-5 / 2.016)),
    },
    coefficients: {
        // Five times Field's k_e, so one wavelength is about the box and the
        // spiral repeats inside it.
        recoveryRate: 0.1,
        stoichiometricFactor: 2.5,              // excitable: f > 1 + sqrt 2
        massDiffusivity: 3.08e-5,               // a front sqrt(D / k_c) one cell wide
        viscosity: 0.002,                       // read by nothing; the panel wants a number
    },
    sliders: {
        massDiffusivity: [3.85e-6, 0.0002464],
        recoveryRate: [0.0125, 0.8],
        stoichiometricFactor: [0.3125, 20],
    },
    // Concentrations in mM. Each species' scale is its peak, and the peaks
    // span two orders of magnitude.
    display: { speciesScale: { speciesA: 0.3, speciesB: 1, speciesC: 2.8 } },
}));
