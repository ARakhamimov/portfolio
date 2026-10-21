// offsetJets.js, by Allen Rakhamimov.
// Two feeds entering offset through the side walls, so that they drive a
// rotation. One of a pair with tubeBankOffsetJets; only the obstacles differ.

'use strict';

caseRegister(() => ({
    id: 'offsetJets',
    label: 'Offset jets',
    view: 'species',
    note: 'Two feeds enter offset through the side walls and drive a '
        + 'rotation. The reaction is fast compared to the mixing, so the '
        + 'product traces the interface. The tube bank fed by offset jets is '
        + 'the same case with obstacles added.',
    geometry: { edges: { left: INLET, right: INLET, top: OUTLET, bottom: OUTLET } },
    // Narrow jets. The band sets the throughput as well as the Reynolds number,
    // so a narrow one buys residence time without slowing the jets.
    inlet: {
        speed: 0.5,
        velocityX: profileOffsetJets(0.5, 0.46, 0.62, 0.38, 0.54),
        species: {
            speciesA: profileJetSpecies(1, 0, 0.46, 0.62, 0.38, 0.54),
            speciesB: profileJetSpecies(0, 1, 0.46, 0.62, 0.38, 0.54),
            speciesC: 0,
        },
    },
    // A species cell Peclet number of 1.4 at the jet speed. Below |u|h/2 the
    // blend replaces molecular diffusivity with numerical diffusivity of the
    // same size, so a smaller value would buy nothing.
    coefficients: {
        viscosity: 0.0021,                      // Re 38 on the jet width
        massDiffusivity: 0.0014,
    },
    sliders: { viscosity: [0.0002625, 0.0168], massDiffusivity: [0.000175, 0.0112] },
    // The jets are banded, not parabolic, and the length is the jet's width.
    panel: { velocityScale: 0.5, lengthScale: 0.16 },
    reactions: caseStandardReactions(20),
    defaultReaction: 'massAction',
}));
