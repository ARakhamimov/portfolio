// opposedJets.js, by Allen Rakhamimov.
// Two feeds driven head on, meeting on a stagnation plane.

'use strict';

caseRegister(() => ({
    id: 'opposedJets',
    label: 'Opposed jets',
    view: 'species',
    note: 'Two feeds are driven straight at each other, meet down the middle '
        + 'and leave top and bottom. Nothing stirs them, so product forms only '
        + 'in a thin sheet where they touch.',
    geometry: { edges: { left: INLET, right: INLET, top: OUTLET, bottom: OUTLET } },
    // Both side walls are INLET, so one profile in x serves both: A from the
    // left moving right, B from the right moving left.
    inlet: {
        speed: 0.4,
        velocityX: profileSplitX(0.4, -0.4),
        species: { speciesA: profileSplitX(1, 0), speciesB: profileSplitX(0, 1), speciesC: 0 },
    },
    // A species cell Peclet number of 1.3, just under 2, so the product sheet
    // stays sharp.
    coefficients: { viscosity: 0.004, massDiffusivity: 0.0012 },
    sliders: { viscosity: [0.0005, 0.032], massDiffusivity: [0.00015, 0.0096] },
    // The jets are uniform, so the velocity scale is their speed and not a
    // parabolic peak.
    panel: { velocityScale: 0.4, lengthScale: 1 },
    reactions: caseStandardReactions(8),
    defaultReaction: 'massAction',
}));
