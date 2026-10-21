// views.js, by Allen Rakhamimov.
// The views a viewer can pick: one record per view, with what the system must
// solve before the view has anything to show and what its legend says.
//
// The order of VIEWS is the one numbering of the views: the shader's switch
// (draw.js), the button bar and the legend all index it. A view is its record
// here and its arm in draw.js. Nothing in the solver depends on this file.

'use strict';

// Each record: `name`, the button's label; `needs`, the fields the system must
// solve (allOf, anyOf), and whether it needs an advection term, a material or
// the Lorentz force; `fieldRow`, which fields the row under the views names
// while this view is on; `fieldView: false` for the two views that are not
// pictures of a field; and `legend`, which returns the key, the note and the
// hatch rows (legend.js lays them out).
const VIEWS = [
    {
        name: 'species',
        needs: { anyOf: ['speciesA', 'speciesB', 'speciesC', 'speciesD'] },
        legend: ({ system }) => {
            const d = displaySettings;
            const fields = legendSpeciesFields(system);
            const hues = drawSpeciesHues(d);
            const mix = (some) => legendSpeciesMix(some, hues);
            const hatchOf = (field) => d.speciesHatches[DRAW_SPECIES_FIELDS.indexOf(field)];
            const rows = fields.map((field) => [hatchOf(field), mix([field]), fieldSpecOf(field).label]);
            if (fields.length >= 2) {
                const pair = fields.slice(0, 2);
                rows.push([pair.map(hatchOf), mix(pair),
                    `${pair.map((field) => fieldSpecOf(field).label.replace('species ', '')).join(' and ')} evenly mixed`]);
            }
            return {
                key: legendSwatches(fields.map((field) => [mix([field]), fieldSpecOf(field).label])),
                note: 'Each species has a hue. A mixture takes their hues weighted by their shares, '
                    + 'and the total sets how far the color comes out of white: color = mix(white, '
                    + '&Sigma; s<sub>k</sub> h<sub>k</sub>, min(total, 1)), with s<sub>k</sub> the share of '
                    + 'species k and every amount first divided by the case\'s full scale. The row above '
                    + 'shows one species alone, in the hue it has in the mixture.',
                hatches: rows,
                unstriped: 'Unstriped fluid is a mixture where no single species is clearly ahead.',
            };
        },
    },
    {
        name: 'temperature',
        needs: { allOf: ['temperature'] },
        legend: () => {
            const d = displaySettings;
            const percent = (d.coldThreshold * 100).toFixed(0);
            const foot = d.temperatureHot.map((channel) => channel * d.coldThreshold);
            return {
                key: legendBar(`linear-gradient(to right, ${legendRgb(d.temperatureCold)} 0%, `
                    + `${legendRgb(d.temperatureCold)} ${percent}%, ${legendRgb(foot)} ${percent}%, `
                    + `${legendRgb(d.temperatureHot)} 100%)`, '0', String(d.maxTemperature)),
                note: `Below ${percent}% of full scale the color is flat blue, so an unheated region `
                    + 'reads as one block.',
                unhatched: LEGEND_BRIGHTNESS,
            };
        },
    },
    {
        name: 'velocity',
        needs: { allOf: ['xVelocity', 'yVelocity'] },
        legend: () => viewsDirectionLegend('flow', {
            note: 'Hue is direction and saturation is speed against the peak on this level, so '
                + 'slow fluid fades toward neutral. The cutoff slider blanks everything below a '
                + 'fraction of that peak, which shows where a dead zone ends.',
            unstriped: 'The stripes give the axis and fade with speed; which way along it is what the '
                + 'direction arrows (key <kbd>a</kbd>) show.',
        }),
    },
    {
        name: 'x-velocity',
        needs: { allOf: ['xVelocity'] },
        legend: () => viewsComponentLegend('rightward', 'leftward'),
    },
    {
        name: 'y-velocity',
        needs: { allOf: ['yVelocity'] },
        legend: () => viewsComponentLegend('downward', 'upward'),
    },
    {
        name: 'vorticity',
        needs: { allOf: ['xVelocity', 'yVelocity'] },
        legend: () => {
            const d = displaySettings;
            const ceiling = (d.vorticityFloor * Math.pow(10, d.vorticityDecades)).toFixed(0);
            return {
                key: legendBar(`linear-gradient(to right, ${legendRgb(d.signedCool)} 0%, ${legendRgb(d.signedLight)} `
                    + `50%, ${legendRgb(d.signedWarm)} 100%)`, `${ceiling} counterclockwise`, `${ceiling} clockwise`, 'still'),
                note: 'The local rate of rotation, dv/dx − du/dy, taken at the cell corners where both '
                    + 'differences are centered. Red turns clockwise and blue counterclockwise as drawn, '
                    + `one color step per order of magnitude over ${d.vorticityDecades} of them.`,
                hatches: legendSigned('clockwise as drawn', 'counterclockwise as drawn'),
            };
        },
    },
    {
        name: 'pressure',
        needs: { allOf: ['pressure'] },
        legend: () => ({
            key: legendSignedBar(`−${displaySettings.pressureScale}`, `+${displaySettings.pressureScale}`, '0'),
            note: 'Linear and signed. Only differences push the flow: zero is the outlet\'s '
                + 'pressure, and in a closed box the mean stays where it started.',
            hatches: legendSigned('above zero', 'below zero'),
        }),
    },
    {
        name: 'potential',
        needs: { allOf: ['potential'] },
        legend: ({ plate, system, preset }) => {
            const scale = preset.display.potentialScale;
            const lines = plate.equipotentials[0];
            const count = Math.round(plate.contourCount[0]);
            const note = drawLorentzTerm(system)
                ? 'The color is the induced potential a, linear and signed on this case\'s scale. '
                    + (lines ? 'The lines are field lines, contours of the total A = A<sub>0</sub> + a, each '
                        + `carrying the same flux, so they crowd where the field is strong; this case's own `
                        + `field draws ${count} across the box. After the field strength changes, the currents `
                        + 'the fluid carries keep their lines until the flow rebuilds them.' : '')
                : 'Linear and signed on this case\'s scale. '
                    + (lines ? `The lines are equipotentials, ${displayNumberText(2 * scale / count)} apart; the `
                        + 'field crosses them at right angles.' : '');
            return {
                key: legendSignedBar(`−${scale}`, `+${scale}`, '0'),
                note: note.trim(),
                hatches: legendSigned('above zero', 'below zero'),
            };
        },
    },
    {
        name: 'flux',
        needs: { allOf: ['fluxX', 'fluxY'] },
        legend: ({ preset }) => viewsDirectionLegend('field', {
            note: 'Hue is the field\'s direction, on the velocity view\'s wheel, and saturation '
                + `its strength against this case's scale of ${preset.display.fluxScale}, under a `
                + 'square root.',
            unstriped: 'Unstriped is at or under the floor of the scale.',
        }),
    },
    {
        name: 'current',
        // j = -lap A exists only where the Lorentz force does; an electrostatic
        // potential's Laplacian is a charge density.
        needs: { allOf: ['potential'], lorentz: true },
        legend: ({ preset }) => {
            const scale = preset.display.currentScale;
            return {
                key: legendSignedBar(`−${scale}`, `+${scale}`, '0'),
                note: 'The current out of the plane, j = −∇<sup>2</sup>A, linear and signed on '
                    + 'this case\'s scale. The force on the fluid is this times the slope of A, so the '
                    + 'current is where the field pushes. Evaluated at cell centers.',
                hatches: legendSigned('out of the screen', 'into the screen'),
            };
        },
    },
    {
        name: 'wave function',
        needs: { allOf: ['waveReal', 'waveImaginary'] },
        legend: ({ plate, system, preset }) => ({
            key: legendVelocityWheel(),
            note: 'The wave function ψ = ψ<sub>R</sub> + iψ<sub>I</sub> as a point in the complex '
                + 'plane: hue is its phase, on the velocity view\'s wheel, and saturation its '
                + `amplitude |ψ| against this case's scale of ${preset.display.waveScale}, under a `
                + 'square root. The hue turns once per wavelength.' + legendEnergyLines(plate, system),
            hatches: [['horizontal', [legendHue(0), legendHue(180)], 'phase 0 or 180°'],
                      ['falling', [legendHue(45), legendHue(225)], 'phase 45 or 225°'],
                      ['vertical', [legendHue(90), legendHue(270)], 'phase 90 or 270°'],
                      ['rising', [legendHue(135), legendHue(315)], 'phase 135 or 315°']],
            unstriped: 'Unstriped is at or under the floor of the scale.',
        }),
    },
    {
        name: 'probability density',
        needs: { allOf: ['waveReal', 'waveImaginary'] },
        legend: ({ plate, system, preset }) => {
            const d = displaySettings;
            const scale = preset.display.waveScale;
            return {
                key: legendBar(`linear-gradient(to right, ${legendRgb(d.darkNeutral)}, ${legendRgb(d.densityLight)})`,
                    '0', displayNumberText(scale * scale)),
                note: 'The probability density |ψ|<sup>2</sup> = ψ<sub>R</sub><sup>2</sup> + '
                    + 'ψ<sub>I</sub><sup>2</sup>, linear against this case\'s scale squared: color = '
                    + 'mix(dark, light, min(|ψ|<sup>2</sup> / scale<sup>2</sup>, 1)). Bright is where the '
                    + 'particle is likely to be found.' + legendEnergyLines(plate, system),
                unhatched: LEGEND_BRIGHTNESS,
            };
        },
    },
    {
        name: 'divergence',
        needs: { allOf: ['pressure'] },
        legend: () => {
            const d = displaySettings;
            const ceiling = (d.divergenceThreshold * Math.pow(10, d.divergenceDecades)).toExponential(0);
            return {
                key: legendBar(`linear-gradient(to right, ${legendRgb(d.signedCool)} 0%, ${legendRgb([0, 0, 0])} 42%, `
                    + `${legendRgb(d.divergenceMet)} 42%, ${legendRgb(d.divergenceMet)} 58%, `
                    + `${legendRgb([0, 0, 0])} 58%, ${legendRgb(d.signedWarm)} 100%)`,
                    `−${ceiling}`, `+${ceiling}`, `|div u| &lt; ${d.divergenceThreshold.toExponential(0)}`),
                note: 'Green is the constraint met; above the threshold, one color step per order of '
                    + 'magnitude. This is where a cycle budget that has fallen behind shows.',
                hatches: legendSigned('net outflow from the cell', 'net inflow'),
            };
        },
    },
    {
        name: 'cell Peclet',
        needs: { allOf: ['xVelocity', 'yVelocity'], advection: true },
        fieldRow: 'advected',
        legend: ({ plate, system, values }) => viewsCellNumberLegend(2, {
            note: 'The cell Peclet number |u| h / D of the field picked below, on a log scale, with '
                + 'D that field\'s own diffusivity. Dark is exactly 2: cool cells are differenced '
                + 'centrally, and in warm ones the solver blends toward upwind. Evaluated at cell '
                + 'centers.' + (legendDiffusesAtZero(plate, system, values) ? ' ' + LEGEND_ZERO_DIFFUSIVITY : ''),
            hatches: legendSigned('above 2, blended toward upwind', 'below 2, central'),
        }),
    },
    {
        name: 'upwind blend',
        needs: { allOf: ['xVelocity', 'yVelocity'], advection: true },
        fieldRow: 'advected',
        legend: ({ plate, system, values }) => ({
            key: legendBar(`linear-gradient(to right, ${legendRgb(displaySettings.blendLight)}, `
                + `${legendRgb(displaySettings.blendDark)})`, '0, central', '1, upwind'),
            note: 'How much of the field\'s advection is upwind: 1 − γ, with γ = '
                + 'min(1, 2D / (|u| h)) on each axis, the larger of the two. White is the '
                + 'central-difference answer, and anywhere darker the picture is not. Evaluated at '
                + 'cell centers.' + (legendDiffusesAtZero(plate, system, values) ? ' ' + LEGEND_ZERO_DIFFUSIVITY : ''),
            unhatched: LEGEND_BRIGHTNESS,
        }),
    },
    {
        name: 'Courant number',
        needs: { allOf: ['xVelocity', 'yVelocity'] },
        legend: () => viewsCellNumberLegend(1, {
            note: 'The Courant number |u| dt / h on a log scale, dark at 1: how many cells the flow '
                + 'crosses in one time step. The stepping is implicit, so above 1 is not unstable '
                + 'by itself.',
            hatches: legendSigned('more than one cell per step', 'less than one'),
        }),
    },
    {
        name: 'material',
        needs: { material: true },
        // A profile case's materials as swatches, or a painted case's bare
        // material and a bar per paint from its weakest to its strongest,
        // darkening on a log scale as drawPaintedArm does.
        legend: ({ system }) => {
            const materials = drawMaterials(system);
            const entries = materials ? materials.entries : [];
            const hatches = entries.filter(({ hatch }) => hatch !== 'none')
                .map(({ hatch, color, label }) => [hatch, color, label]);
            const unstriped = entries.length ? `Unstriped is ${entries[0].label}.` : '';
            if (materials && materials.painted) {
                const [bare, ...painted] = entries;
                const strongest = displaySettings.paintedStrongest;
                return {
                    key: legendSwatches([[bare.color, bare.label]])
                        + painted.map(({ label, color, dark }) => `<p class="legendNote">${label}</p>`
                            + legendBar(`linear-gradient(to right, ${legendRgb(color)}, ${legendRgb(dark)})`,
                                '×1', `×${strongest}`, `×${Math.sqrt(strongest).toFixed(1)}`)).join(''),
                    note: 'What you have painted, darker where stronger: mix(light, dark, '
                        + `log<sub>2</sub>(strength) / ${Math.log2(strongest)}). Catalyst is read at cell centers; the porous medium `
                        + 'is read on the faces, where the momentum rows are, and a cell shows the mean of its '
                        + 'four. Each is its own layer, so catalyst painted over porous medium makes a '
                        + 'catalytic bed, and where layers overlap the cell takes the mean of their colors '
                        + '(the row below shows one alone). Bare clears every layer. Catalyst does nothing '
                        + 'until a reaction is chosen.',
                    hatches, unstriped,
                };
            }
            return {
                key: legendSwatches(entries.map(({ color, label }) => [color, label])),
                note: 'What the case is made of, one color per material. A material is a value of a '
                    + 'coefficient fixed in space; one that moves with a field, such as a diffusivity that '
                    + 'depends on temperature, is not drawn here. Each cell shows the material at its center '
                    + 'on the level shown, so a curved boundary is the staircase the solver reads.',
                hatches, unstriped,
            };
        },
    },
    {
        name: 'residual',
        fieldRow: 'residual',
        legend: () => {
            const d = displaySettings;
            const ceiling = (d.residualFloor * Math.pow(10, d.residualDecades)).toExponential(0);
            return {
                key: legendBar(`linear-gradient(to right, ${legendRgb(d.residualFloorColor)}, `
                    + `${legendRgb(d.residualColor)})`, `&lt; ${d.residualFloor.toExponential(0)}`, ceiling),
                note: `Magnitude only, over ${d.residualDecades} orders of magnitude, for the field picked `
                    + 'above. The two velocity components have residuals too, but they live on faces and '
                    + 'this view samples cell centers.',
                unhatched: LEGEND_BRIGHTNESS,
            };
        },
    },
    {
        name: 'boundary type',
        fieldView: false,
        legend: () => {
            const colors = displaySettings.boundaryColors;
            const colorOf = (name) => colors[BOUNDARY_NAMES.indexOf(name)];
            return {
                key: legendSwatches(BOUNDARY_NAMES.map((name, k) => [colors[k], name])),
                note: 'The one view that draws the ghost ring, where the domain\'s edge types live. '
                    + 'Inert is padding with no neighboring cell. No arrows are drawn here, since they '
                    + 'would sit out of register with the ring.',
                hatches: [['horizontal', colorOf('inlet'), 'inlet'], ['rising', colorOf('outlet'), 'outlet'],
                          ['falling', colorOf('symmetry'), 'symmetry'], ['vertical', colorOf('inert'), 'inert']],
                unstriped: 'Unstriped is fluid or wall.',
            };
        },
    },
    {
        name: 'coordinates',
        fieldView: false,
        legend: () => ({
            key: '',
            note: 'Not a field: red rises with the column, green with the row, and blue steps every '
                + 'eighth cell. A region that breaks the gradient is one no invocation reached.',
            unhatched: 'This view is a test pattern and not a field, and hatching it would only '
                + 'make it harder to see what it is for.',
        }),
    },
];

const VIEW_NAMES = VIEWS.map((view) => view.name);

function viewsRecord(name) {
    return VIEWS.find((view) => view.name === name);
}

// The views this system can fill, in the order of VIEWS.
function viewsOffered(system) {
    const solved = drawSolvedFields(system);
    const advects = drawAdvectedEquations(system).length > 0;
    return VIEWS.filter(({ needs }) => {
        if (!needs) return true;
        if (needs.allOf && !needs.allOf.every((field) => solved.has(field))) return false;
        if (needs.anyOf && !needs.anyOf.some((field) => solved.has(field))) return false;
        if (needs.advection && !advects) return false;
        if (needs.material && !drawMaterials(system)) return false;
        if (needs.lorentz && !drawLorentzTerm(system)) return false;
        return true;
    }).map(({ name }) => name);
}

// The field row

function viewsUseFieldRow(viewName) {
    const view = viewsRecord(viewName);
    return Boolean(view && view.fieldRow);
}

// What the field row names: the advected fields under the cell-number views,
// the residual fields under anything else.
function viewsFieldRow(system, viewName) {
    const view = viewsRecord(viewName);
    return view && view.fieldRow === 'advected'
        ? drawAdvectedEquations(system).map(({ equation }) => equation.field)
        : drawResidualFields(system);
}

// Legends two views share

// A vector drawn by direction: hue on the velocity view's wheel, and a hatch
// along its axis.
function viewsDirectionLegend(word, { note, unstriped }) {
    return {
        key: legendVelocityWheel(),
        note,
        hatches: [['horizontal', [legendHue(0), legendHue(180)], `${word} along the horizontal`],
                  ['falling', [legendHue(45), legendHue(225)], `${word} along the falling diagonal`],
                  ['vertical', [legendHue(90), legendHue(270)], `${word} along the vertical`],
                  ['rising', [legendHue(135), legendHue(315)], `${word} along the rising diagonal`]],
        unstriped,
    };
}

// One velocity component, signed.
function viewsComponentLegend(plus, minus) {
    const speed = displaySettings.maxSpeed;
    return {
        key: legendSignedBar(`${speed} ${minus}`, `${speed} ${plus}`, '0'),
        note: `One component, signed: red is ${plus} and blue is ${minus} as drawn. The returning `
            + 'part of a wake is the part that changes sign.',
        hatches: legendSigned(plus, minus),
    };
}

// A cell number on a log scale around the value that matters, `pivot`.
function viewsCellNumberLegend(pivot, { note, hatches }) {
    const span = Math.pow(10, displaySettings.cellNumberDecades);
    const number = (x) => (x >= 1 ? String(x) : x.toPrecision(1));
    return {
        key: legendSignedBar(number(pivot / span), number(pivot * span), String(pivot)),
        note,
        hatches,
    };
}
