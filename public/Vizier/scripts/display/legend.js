// legend.js, by Allen Rakhamimov.
// The legend under the picture: it lays out the view's color key, its hatch
// key and the notes for the overlays drawn over it. What each view's legend
// says is its record in views.js.
//
// A legend cannot be produced by the shader that draws the canvas, so this is
// the one place a rule is written twice. Both sides read their numbers and
// colors from displaySettings; the formulas are what is kept in step with
// draw.js by hand. Nothing in the solver depends on this file.

'use strict';

// The legend

// Everything under the picture for the view on show. The preset carries the
// case's display scales, and `values` the live coefficient slots.
function legendHtml(plate, system, preset, values) {
    const view = VIEWS[plate.viewMode[0]];
    const entry = view.legend({ plate, system, preset, values });
    const fieldView = view.fieldView !== false;
    const note = entry.note + (fieldView ? ' ' + LEGEND_SOLID : '');
    let html = entry.key + `<p class="legendNote">${note}</p>`;
    const vector = drawVectorPair(system);
    const hasVector = system.equations.some((equation) => equation.field === vector.x);
    if (plate.arrows[0] && fieldView && hasVector) html += legendArrowNote(system);
    if (plate.streamlines[0] && divergenceFreePair(system) !== null && fieldView) html += legendStreamlineNote(plate);
    if (plate.accessible[0]) html += legendHatchKey(plate, entry);
    return html;
}

// The equipotentials of a wave function's potential energy, when they are on.
function legendEnergyLines(plate, system) {
    if (!plate.equipotentials[0] || !drawPotentialEnergyShape(system)) return '';
    return ' The lines are equipotentials of the potential energy V, read where the solver reads '
        + 'it, at cell centers on the level shown, and smoothed between them when bilinear is on. '
        + 'The equipotentials key (<kbd>e</kbd>) hides them.';
}

const LEGEND_SOLID = 'Obstacles and walls are solid gray in every field view.';

const LEGEND_ZERO_DIFFUSIVITY = 'This field is asked to diffuse at zero, so the solver runs it fully '
    + 'upwind wherever it moves and the view is one color.';

// Whether the field picked in the row under the views has a diffusivity of
// zero, read as the solver reads it: a number, or a slot's live value.
function legendDiffusesAtZero(plate, system, values) {
    const advected = drawAdvectedEquations(system);
    const picked = advected[plate.viewField[0]] || advected[0];
    if (!picked) return false;
    const diffusivity = picked.term.diffusivity;
    const value = typeof diffusivity === 'number' ? diffusivity : values[diffusivity.coefficientSlot];
    return value === 0;
}

// A signed view's hatch rows: rising where the value is above zero, falling
// below.
function legendSigned(above, below) {
    return [['rising', displaySettings.signedWarm, above], ['falling', displaySettings.signedCool, below]];
}

const LEGEND_BRIGHTNESS = 'This view carries its magnitude in brightness, which color vision '
    + 'deficiency does not affect, so a stripe would cost resolution and add nothing.';

// Overlay notes

function legendArrowNote(system) {
    const text = drawVectorPair(system).x === 'fluxX'
        ? 'Arrows point along the field, their length carrying its strength against this case\'s '
            + 'scale. None is drawn where it is near zero.'
        : 'Arrows point along the flow, their length carrying speed. None is drawn in fluid near rest.';
    return `<p class="legendNote">${legendArrowMark()} ${text}</p>`;
}

function legendStreamlineNote(plate) {
    const count = Math.round(plate.contourCount[0]);
    return `<p class="legendNote">Streamlines: ${count} contours of the stream function between zero
            and its largest value, so equal flow passes between neighboring lines and they crowd where
            the flow is strong. They show the flow at this instant; while the picture is still changing,
            they are not the paths fluid follows.</p>`;
}

function legendArrowMark() {
    return `<svg class="legendArrow" viewBox="0 0 30 12" aria-hidden="true">
                <path d="M1 6 H20 M20 1.5 L28 6 L20 10.5 Z"
                      fill="currentColor" stroke="currentColor" stroke-width="2"
                      stroke-linejoin="round"/>
            </svg>`;
}

// The hatch key

// A swatch is drawn at the period the canvas draws, read off the plate, since
// the shader converts it to screen pixels. Its stripe profile is a triangle
// where the shader's is a sine; the direction and period are what match.
function legendHatchKey(plate, entry) {
    const toggle = 'Press <kbd>h</kbd> to compare with the plain view.';
    if (!entry.hatches || !entry.hatches.length) {
        return `<div class="legendHatch"><p class="legendNote">Hatching is on, but not in this view. `
            + `${entry.unhatched || ''} ${toggle}</p></div>`;
    }
    const keys = entry.hatches
        .map(([direction, color, meaning]) => `<li>${legendHatchSwatch(plate, direction, color)}${meaning}</li>`)
        .join('');
    const unstriped = entry.unstriped || 'Unstriped is at or under the floor of the scale.';
    return `<div class="legendHatch"><ul class="legendKeys">${keys}</ul>`
        + '<p class="legendNote">Hatching lightens and darkens the color symmetrically, so the hue '
        + 'and the mean brightness stay. Its direction says what the color means here, a second way '
        + 'to read it if you cannot separate the hues. The period is '
        + `${plate.hatchPitch[0].toFixed(0)} screen pixels. ${unstriped} ${toggle}</p></div>`;
}

const LEGEND_HATCH_ANGLE = {
    vertical: '90deg',      // stripes upright, phase along x
    horizontal: '180deg',   // stripes flat
    rising: '135deg',       // "/" as drawn
    falling: '45deg',       // "\" as drawn
};

// One direction or several, layered as translucent bands toward white and
// toward black, several splitting the depth between them as the shader does.
// A pair of colors is an axis with two senses, split down the swatch.
function legendHatchSwatch(plate, direction, color) {
    const pitch = plate.hatchPitch[0];
    const directions = Array.isArray(direction) ? direction : [direction];
    const depth = (plate.hatchDepth[0] / directions.length).toFixed(3);
    const at = (fraction) => `${(pitch * fraction).toFixed(2)}px`;
    const layers = directions.map((one) => [
        `repeating-linear-gradient(${LEGEND_HATCH_ANGLE[one]}`,
        `rgb(255 255 255 / ${depth}) 0`,
        `rgb(255 255 255 / 0) ${at(0.25)}`,
        `rgb(0 0 0 / 0) ${at(0.25)}`,
        `rgb(0 0 0 / ${depth}) ${at(0.5)}`,
        `rgb(0 0 0 / 0) ${at(0.75)}`,
        `rgb(255 255 255 / 0) ${at(0.75)}`,
        `rgb(255 255 255 / ${depth}) ${at(1)})`,
    ].join(', '));
    const base = Array.isArray(color[0])
        ? `linear-gradient(90deg, ${legendRgb(color[0])} 50%, ${legendRgb(color[1])} 50%)`
        : `linear-gradient(${legendRgb(color)}, ${legendRgb(color)})`;
    layers.push(base);
    return `<i style="background:${layers.join(', ')}"></i>`;
}

// Pieces

function legendRgb(color) {
    const channel = (value) => Math.round(255 * Math.min(1, Math.max(0, value)));
    return `rgb(${channel(color[0])} ${channel(color[1])} ${channel(color[2])})`;
}

function legendBar(gradient, low, high, middle) {
    const labels = middle === undefined
        ? `<span>${low}</span><span>${high}</span>`
        : `<span>${low}</span><span>${middle}</span><span>${high}</span>`;
    return `<div class="legendBar" style="background:${gradient}"></div>
            <div class="legendScale">${labels}</div>`;
}

// The linear signed ramp drawSignedLinearColor draws: cool, the dark neutral,
// warm.
function legendSignedBar(low, high, middle) {
    const d = displaySettings;
    return legendBar(`linear-gradient(to right, ${legendRgb(d.signedCool)}, ${legendRgb(d.darkNeutral)} 50%, `
        + `${legendRgb(d.signedWarm)})`, low, high, middle);
}

// [color, name] pairs as a row of swatches.
function legendSwatches(entries) {
    return '<ul class="legendKeys">' + entries
        .map(([color, name]) => `<li><i style="background:${legendRgb(color)}"></i>${name}</li>`)
        .join('') + '</ul>';
}

// The species this system solves, in DRAW_SPECIES_FIELDS order.
function legendSpeciesFields(system) {
    return drawOfferedSpecies(system).map(({ field }) => field).filter(Boolean);
}

// A species alone at full scale, or an even mixture of several, as
// drawSpeciesColor computes it: the share-weighted hue at a total of one.
function legendSpeciesMix(fields, hues) {
    const picked = fields.map((field) => hues[DRAW_SPECIES_FIELDS.indexOf(field)]);
    return [0, 1, 2].map((k) => picked.reduce((sum, hue) => sum + hue[k], 0) / picked.length);
}

// drawDirectionHue, transcribed, at an angle in degrees as drawn.
function legendHue(degrees) {
    const turns = ((degrees / 360) % 1 + 1) % 1;
    const scaled = turns * 3;
    const sector = Math.floor(scaled) % 3;
    const f = scaled - Math.floor(scaled);
    if (sector === 0) return [1 - f, f, 0];
    if (sector === 1) return [0, 1 - f, f];
    return [f, 0, 1 - f];
}

// The wheel in screen orientation (a positive y velocity points down), with
// its middle neutral, since saturation is speed.
function legendVelocityWheel() {
    const stops = [];
    for (let step = 0; step <= 24; step++) {
        const cssAngle = step * 15;
        stops.push(`${legendRgb(legendHue((cssAngle + 270) % 360))} ${cssAngle}deg`);
    }
    const cardinal = [[0, 'flow right'], [90, 'flow down'], [180, 'flow left'], [270, 'flow up']]
        .map(([angle, name]) => [legendHue(angle), name]);
    return `<div class="legendWheel">
                <div class="wheel" style="background:
                    radial-gradient(circle closest-side, ${legendRgb(displaySettings.darkNeutral)} 0%, rgb(0 0 0 / 0) 72%),
                    conic-gradient(${stops.join(',')})"></div>
                ${legendSwatches(cardinal)}
            </div>`;
}
