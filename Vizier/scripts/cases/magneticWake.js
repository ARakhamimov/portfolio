// magneticWake.js, by Allen Rakhamimov.
// A conducting fluid past a cylinder in a magnetic field along the flow.

'use strict';

caseRegister(() => ({
    id: 'magneticWake',
    label: 'Magnetic wake',
    view: 'potential',
    note: 'A conducting fluid flows past a cylinder in a magnetic field along '
        + 'the flow. The vortex street sweeps the field lines, and they push '
        + 'back on motion across them. Raise the field strength to brake the '
        + 'street.',
    // In 2D with the field in the plane the force acts only on motion across
    // the field lines, so the oncoming stream is left alone and the sway that
    // sheds the street is braked.
    system: { physics: 'mhd', magneticFieldAlong: 'x', transportsSpecies: false },
    // Off the midline by half a cell, so the street starts.
    geometry: { solidCircles: [{ x: 0.2, y: 0.502, radius: 0.05 }] },
    inlet: { speed: 0.5, velocityX: profileParabolic(0.5) },      // mean 0.5, peak 0.75
    // Re 100 sheds; Rm 10 lets the street sweep the lines while its current
    // sheets stay several cells wide; N about 0.6 acts on the street without
    // stopping it. The slider's top is near the step limit the lagged coupling
    // sets.
    coefficients: {
        viscosity: 0.0005,                      // Re 100 on the diameter, 0.1
        magneticDiffusivity: 0.005,             // Rm 10
        appliedField: 0.12,                     // the Alfven speed; N about 0.6
    },
    sliders: { viscosity: [6.25e-5, 0.004], appliedField: [0.015, 0.96] },
    // From the induction balance: a current of order B0 v / eta.
    display: { fieldLineScale: 0.12, potentialScale: 0.05, currentScale: 5 },
}));
