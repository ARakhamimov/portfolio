// magneticThruster.js, by Allen Rakhamimov.
// An MHD drive: a duct in a tank of conducting fluid, pushed by a current
// across a magnetic field.

'use strict';

caseRegister(() => ({
    id: 'magneticThruster',
    label: 'MHD thruster',
    view: 'species',
    note: 'A duct in a tank of conducting fluid, with a magnetic field across '
        + 'the tank and electrodes on the duct\'s faces. Current across the '
        + 'field pushes fluid out of the duct as a jet, with no moving parts. '
        + 'Outside the duct the field brakes the jet.',
    // The electrodes are out of the screen, so the applied electric field, the
    // current and the force are confined to the duct; the magnetic field fills
    // the tank.
    system: {
        physics: 'mhd',
        magneticFieldAlong: 'y',
        electricFieldSign: '-',
        electricFieldRegion: profileRectangleWeight(0.30, 0.42, 0.70, 0.58),
    },
    // Two plates make the duct; each is over two coarse cells thick.
    geometry: {
        edges: { left: WALL, right: WALL, top: WALL, bottom: WALL },
        solidBoxes: [[0.30, 0.355, 0.70, 0.42], [0.30, 0.58, 0.70, 0.645]],
    },
    inlet: { speed: 0, species: {} },
    // The duct's contents start red, and the fluid waiting at its mouth green.
    initial: {
        patches: [
            { field: 'speciesA', value: 1, at: (x, y) => x > 0.3 && x < 0.7 && y > 0.42 && y < 0.58 },
            { field: 'speciesB', value: 1, at: (x, y) => x > 0.1 && x <= 0.3 && y > 0.42 && y < 0.58 },
        ],
    },
    // A small magnetic Reynolds number, so the lines barely bend. At 64 cells
    // the duct's centerline reaches 0.54 at t 2.5.
    coefficients: {
        viscosity: 0.001,                       // Re about 90 on the duct's width
        massDiffusivity: 0.0005,
        magneticDiffusivity: 1,
        appliedField: 0.3,
        appliedElectricField: 2,                // a current E0 / eta of 2 in the duct
    },
    sliders: {
        viscosity: [0.000125, 0.008],
        massDiffusivity: [6.25e-5, 0.004],
        appliedField: [0.0375, 2.4],
        appliedElectricField: [0.25, 16],
    },
    display: {
        fieldLineScale: 0.3,
        potentialScale: 0.006,                  // the peak |a|, near 0.006
        currentScale: 2,
    },
    panel: { velocityScale: 0.5, lengthScale: 0.16 },          // about the jet's speed; the duct's width
}));
