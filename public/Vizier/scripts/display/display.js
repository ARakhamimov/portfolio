// display.js, by Allen Rakhamimov.
// Every color and threshold the draw shader and the legends read, and how the
// page writes a number.
//
// One table, so a threshold or a color changes in one place and the legend
// cannot draw a different red from the canvas. Nothing in the solver depends on
// this file.

'use strict';

const displaySettings = {
    maxTemperature: 100,
    coldThreshold: 0.03,
    temperatureHot: [1.0, 0.55, 0.0],
    temperatureCold: [0.0, 0.0, 0.19],
    maxConcentration: 1,
    // The species view: hue is what a mixture is made of, each species' hue
    // weighted by its share; lightness is how much, mixing out of white as the
    // scaled total rises to one. A deep matte palette, in DRAW_SPECIES_FIELDS
    // order; see drawSpeciesHues.
    speciesHues: [
        [0.70, 0.15, 0.17],     // A, red
        [0.13, 0.52, 0.30],     // B, green
        [0.15, 0.30, 0.62],     // C, blue
        [0.85, 0.62, 0.13],     // D, gold
    ],
    speciesHatches: ['vertical', 'horizontal', 'rising', 'falling'],
    maxSpeed: 2,
    // Green below the threshold, one ramp per order of magnitude above. A
    // converged field is about 1e-5 at worst, so it stays green with four
    // orders above it to show where the budget fell behind.
    divergenceThreshold: 1e-7,
    divergenceDecades: 4,
    divergenceMet: [0.0, 0.45, 0.0],
    residualFloor: 1e-8,
    residualDecades: 6,
    residualColor: [0.45, 0.15, 0.75],
    residualFloorColor: [0.03, 0.03, 0.05],
    // Signed orders of magnitude, since a rotating flow spans several: a
    // cavity's corner vortices are two or three orders under its core. The
    // ramp mixes out of signedLight, so a weak vortex is tinted, not lost.
    vorticityFloor: 0.01,
    vorticityDecades: 3,
    pressureScale: 40,
    // Orders of magnitude either side of a cell number's threshold before its
    // ramp saturates, and the dark end of the upwind-blend ramp.
    cellNumberDecades: 2,
    blendLight: [0.97, 0.97, 0.98],
    blendDark: [0.45, 0.05, 0.10],
    // The bright end of the probability density's ramp, out of darkNeutral.
    densityLight: [1.0, 0.93, 0.70],
    // The signed ramps and their legends share these. The linear ramp runs
    // from cool through the dark neutral to warm; the dark neutral is also
    // where the velocity view's saturation fades to.
    signedWarm: [0.90, 0.16, 0.13],
    signedCool: [0.25, 0.45, 0.95],
    darkNeutral: [0.05, 0.05, 0.07],
    // A solid cell in every field view.
    solidColor: [0.30, 0.30, 0.34],
    // The stripes a value past 1e6 or NaN is drawn in, so it cannot pass for
    // a zero.
    brokenLight: [1.0, 0.0, 0.8],
    brokenDark: [0.25, 0.0, 0.2],
    // A painted layer darkens on a log scale from x1 to this strength.
    paintedStrongest: 8,
    // Indexed by the boundary type enum in geometry.js; the shader, the legend
    // and the hatch key all read it.
    boundaryColors: [
        [0.05, 0.05, 0.08],     // fluid
        [0.55, 0.55, 0.60],     // wall
        [0.20, 0.70, 0.35],     // inlet
        [0.85, 0.45, 0.15],     // outlet
        [0.30, 0.45, 0.85],     // symmetry
        [0.40, 0.10, 0.40],     // inert
    ],
    // Light, so near-zero rotation reads as blank and noise does not speckle.
    signedLight: [0.96, 0.96, 0.97],

    // The switches a page opens with, and the hatch, arrow and contour
    // spacings, are CONTROLS_MEMBERS in grid.js: they live in the controls
    // buffer, so toggling one is a buffer write.
    accessibleFloor: 0.02,      // below this share of full scale a cell is unhatched
    arrowFloor: 0.005,          // of the peak speed; no arrow in stagnant fluid
    arrowOpacity: 0.9,
    arrowBody: [0.97, 0.97, 0.98],
    arrowOutline: [0.02, 0.02, 0.03],
    // A contour's width in screen pixels. Its ink is black over a color
    // brighter than this luminance and white over a darker one.
    contourWidth: 1.6,
    contourOpacity: 0.7,
    contourInkLuminance: 0.45,
};

// A number for the page, to three significant figures: plain between 1e-4 and
// 1e4, exponent form outside, since a slider leaves a long binary fraction.
function displayNumberText(value) {
    if (!Number.isFinite(value)) return String(value);
    if (value === 0) return '0';
    const size = Math.abs(value);
    const text = (size >= 1e-4 && size < 1e4)
        ? String(Number(value.toPrecision(3)))
        : value.toExponential(2).replace(/\.?0+e/, 'e');
    return text;
}
