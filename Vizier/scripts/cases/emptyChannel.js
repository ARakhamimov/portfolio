// emptyChannel.js, by Allen Rakhamimov.
// Two feeds through an empty channel: the reference the other channels are
// compared against.

'use strict';

caseRegister(() => ({
    id: 'emptyChannel',
    label: 'Empty channel',
    view: 'species',
    note: 'Two feeds enter side by side and flow down an empty channel with '
        + 'nothing to stir them. The other channel cases are compared against '
        + 'this one.',
    wall: { temperature: 80 },
    coefficients: { viscosity: 0.01 },
    sliders: { viscosity: [0.00125, 0.08], massDiffusivity: [0.00125, 0.08] },
    reactions: caseStandardReactions(4),
    defaultReaction: 'none',
}));
