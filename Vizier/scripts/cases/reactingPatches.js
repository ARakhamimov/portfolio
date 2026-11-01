// reactingPatches.js, by Allen Rakhamimov.
// Reaction and diffusion with no flow: two fed patches and the front between
// them.

'use strict';

caseRegister(() => ({
    id: 'reactingPatches',
    label: 'Reacting patches',
    view: 'species',
    note: 'Two patches hold A and B at fixed strength, and with no flow '
        + 'everything else happens by diffusion. With a reaction chosen, '
        + 'product forms in a band where the two fronts meet.',
    // No flow: the species rows alone, with every edge closed.
    system: { physics: 'noFlow' },
    geometry: { edges: { left: WALL, right: WALL, top: WALL, bottom: WALL } },
    inlet: { speed: 0, temperature: 20, species: { speciesA: 0, speciesB: 0, speciesC: 0 } },
    wall: { temperature: 20 },
    // A viscosity of zero, since nothing reads it here; zero also keeps its
    // slider off the page.
    coefficients: { viscosity: 0, massDiffusivity: 0.004 },
    sliders: { massDiffusivity: [0.0005, 0.032] },
    // Fed hard against the reaction, so each patch holds its species near one.
    feeds: [
        { field: 'speciesA', rate: 40, target: 1, ...profileDiskWeight(0.32, 0.50, 0.10) },
        { field: 'speciesB', rate: 40, target: 1, ...profileDiskWeight(0.68, 0.50, 0.10) },
    ],
    reactions: caseStandardReactions(20),
    defaultReaction: 'massAction',
}));
