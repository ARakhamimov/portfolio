// wakeAtMeshLimit.js, by Allen Rakhamimov.
// A vortex street past a cylinder sixteen cells wide, past what the mesh
// resolves at its fastest point.

'use strict';

caseRegister(() => ({
    id: 'wakeAtMeshLimit',
    label: 'Wake at the mesh limit',
    view: 'velocity',
    note: 'A vortex street past a cylinder only sixteen cells wide, beyond '
        + 'what the mesh resolves at its fastest point. The panel shows the '
        + 'Reynolds number requested beside the one the mesh delivers there. '
        + 'The slower wake keeps more of it, so the street still sheds.',
    // Well upstream, leaving nearly eight diameters of wake.
    geometry: { solidCircles: [{ x: 0.1, y: 0.5, radius: 0.0305 }] },
    inlet: { speed: 0.5, velocityX: profileParabolic(0.5) },      // mean 0.5, peak 0.75
    wall: { temperature: 80 },
    coefficients: { viscosity: 0.0004, massDiffusivity: 0.0015 },
    sliders: { viscosity: [5e-5, 0.0032], massDiffusivity: [0.0001875, 0.012] },
    reactions: caseStandardReactions(50),
    defaultReaction: 'none',
}));
