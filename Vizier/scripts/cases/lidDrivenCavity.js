// lidDrivenCavity.js, by Allen Rakhamimov.
// A square box with a sliding lid, compared visually with Ghia, Ghia and Shin.

'use strict';

caseRegister(() => ({
    id: 'lidDrivenCavity',
    label: 'Lid-driven cavity',
    // Vorticity, since the corner vortices are two orders of magnitude weaker
    // than the primary one and the velocity wheel cannot show them.
    view: 'vorticity',
    note: 'A square box whose lid slides at unit speed. One large vortex '
        + 'fills the box, with much weaker counter-rotating ones in the bottom '
        + 'corners, as in the published solutions.',
    // The lid is an INLET, which in the type-keyed table means "velocity fully
    // prescribed here": no normal component, so nothing enters, and the lid
    // speed along it.
    geometry: { edges: { left: WALL, right: WALL, top: INLET, bottom: WALL } },
    // The lid feeds a tracer, so the species view draws the vortices.
    inlet: { speed: 1, temperature: 20, species: { speciesA: 1, speciesB: 0, speciesC: 0 } },
    // The tracer diffuses as fast as momentum, so both cell Peclet numbers
    // stay equal and under 2.
    coefficients: {
        viscosity: 0.0025,                      // Re 400
        massDiffusivity: 0.0025,
    },
    sliders: { viscosity: [0.0003125, 0.02], massDiffusivity: [0.0003125, 0.02] },
    panel: { lengthScale: 1 },
}));
