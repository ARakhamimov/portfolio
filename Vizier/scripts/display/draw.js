// draw.js, by Allen Rakhamimov.
// The display kernel: one invocation per pixel, turning the solved fields into
// the picture.
//
// The first part reads off a system what the shader can draw (its species,
// materials and overlays); the rest writes the shader, one section per
// function, in the order makeDrawCode lists them, ending with one arm per view
// in the order of VIEWS (views.js). Nothing in the solver reads any of it, so a
// first read can skip the file.

'use strict';

// What a system holds

function drawSolvedFields(system) {
    return new Set(system.equations.map((equation) => equation.field));
}

// Species

// In the order controls.viewSpecies numbers them, after 0 for the mixture.
const DRAW_SPECIES_FIELDS = ['speciesA', 'speciesB', 'speciesC', 'speciesD'];

// The hue of each species, in DRAW_SPECIES_FIELDS order. A species keeps its
// hue whatever else the system solves.
function drawSpeciesHues(display) {
    return DRAW_SPECIES_FIELDS.map((field, k) => display.speciesHues[k]);
}

// The viewSpecies values this system can show: the mixture, then each species
// it solves.
function drawOfferedSpecies(system) {
    const solved = drawSolvedFields(system);
    const offered = DRAW_SPECIES_FIELDS
        .map((field, index) => ({ field, value: index + 1 }))
        .filter(({ field }) => solved.has(field));
    return offered.length ? [{ field: null, value: 0 }, ...offered] : [];
}

// Materials
//
// A case whose coefficient is fixed in space names the materials it is made
// of: a label, a color, and either the factor its profile takes there or, in a
// painted case, the paint it draws. drawMaterials is the one list the shader's
// arm and the legend both read.

const DRAW_MATERIAL_HATCHES = ['none', 'vertical', 'horizontal', 'rising', 'falling'];

// The viewMaterial values a painted case can show: 0 for every layer, then k
// for the k-th painted material alone. Empty for any other case.
function drawOfferedMaterials(system) {
    const materials = drawMaterials(system);
    if (!materials || !materials.painted) return [];
    const [, ...painted] = materials.entries;
    return [{ label: 'all', value: 0 }, ...painted.map(({ label }, k) => ({ label, value: k + 1 }))];
}

// Every coefficient profile the system's terms carry, once each.
function drawProfilesOf(system) {
    const found = new Map();
    for (const value of drawTermValues(system)) {
        if (value.coefficientProfile) found.set(value.coefficientProfile.wgsl, value.coefficientProfile);
    }
    return [...found.values()];
}

// The painted arrays the system reads, by the material each holds.
function drawPaintedMaterialsRead(system) {
    const found = new Set();
    for (const value of drawTermValues(system)) {
        if (value.coefficientPainted) {
            found.add(value.coefficientPainted.array === 'paintCatalystCenter' ? 'catalyst' : 'porous');
        }
    }
    return found;
}

// Every object inside every term, walking down until a coefficient form is
// found, which is returned whole.
function drawTermValues(system) {
    const values = [];
    const walk = (value) => {
        if (!value || typeof value !== 'object') return;
        if (value.coefficientProfile || value.coefficientPainted) { values.push(value); return; }
        for (const inner of Object.values(value)) walk(inner);
    };
    for (const equation of system.equations) for (const term of equation.terms) walk(term);
    return values;
}

// The material map of a painted case: the unpainted material first, then one
// per paint with a color at the weakest strength and a dark one at the
// strongest. A material whose paint the running system does not read is still
// drawn, since a viewer may paint before choosing a reaction.
function drawPaintedMap(system, read) {
    const name = system.name || 'a system';
    const materials = system.materials;
    if (!Array.isArray(materials) || materials.length < 2) {
        throw new Error(`${name} reads painted coefficients, so it declares its materials, the `
            + 'unpainted one first (cases.js, materials)');
    }
    drawCheckMaterialCount(name, materials);
    const [bare, ...painted] = materials;
    if (bare.paint !== undefined) throw new Error(`${name}: its first material is the unpainted one`);
    for (const material of painted) {
        if (!['catalyst', 'porous'].includes(material.paint) || !material.dark) {
            throw new Error(`${name}: painted material ${material.label} needs a paint (catalyst or `
                + 'drag) and a dark color for its strongest strength');
        }
    }
    for (const paint of read) {
        if (!painted.some((material) => material.paint === paint)) {
            throw new Error(`${name} reads painted ${paint}, which no material draws`);
        }
    }
    return { painted: true, entries: drawWithHatches(materials) };
}

// The material map, or null where nothing in the system is fixed in space.
// A profile case is checked on a 65 by 65 sample: every value the profile
// takes must be a material, and every material must be taken somewhere.
function drawMaterials(system) {
    const read = drawPaintedMaterialsRead(system);
    const profiles = drawProfilesOf(system);
    const name = system.name || 'a system';
    if (read.size && profiles.length) {
        throw new Error(`${name} is both painted and varied by a profile; the material view `
            + 'draws one or the other');
    }
    if (read.size) return drawPaintedMap(system, read);
    if (!profiles.length) return null;
    if (profiles.length > 1) {
        throw new Error(`${name} varies ${profiles.length} coefficients in space; the material `
            + 'view draws one, and choosing between several needs a row no case has needed');
    }
    const materials = system.materials;
    if (!Array.isArray(materials) || !materials.length) {
        throw new Error(`${name} varies a coefficient in space, so it declares its materials `
            + '(cases.js, materials)');
    }
    drawCheckMaterialCount(name, materials);
    const [shape] = profiles;
    const matches = (value, factor) => Math.abs(value - factor) <= 1e-9 * Math.max(1, factor);
    const seen = new Set();
    const samples = 65;
    for (let row = 0; row < samples; row++) {
        for (let column = 0; column < samples; column++) {
            const value = shape.at(column / (samples - 1), row / (samples - 1));
            const index = materials.findIndex(({ factor }) => matches(value, factor));
            if (index < 0) throw new Error(`${name}: its profile takes ${value}, which no material names`);
            seen.add(index);
        }
    }
    materials.forEach(({ label }, index) => {
        if (!seen.has(index)) throw new Error(`${name}: no point of its profile is ${label}`);
    });
    return { shape, entries: drawWithHatches(materials) };
}

function drawCheckMaterialCount(name, materials) {
    if (materials.length > DRAW_MATERIAL_HATCHES.length) {
        throw new Error(`${name} declares ${materials.length} materials; the hatches name at most `
            + DRAW_MATERIAL_HATCHES.length);
    }
}

function drawWithHatches(materials) {
    return materials.map((material, index) => ({ ...material, hatch: DRAW_MATERIAL_HATCHES[index] }));
}

// Overlays and the fields they read

// The Lorentz force term a magnetic system carries, or null. The field lines
// and the current view read the applied field from it.
function drawLorentzTerm(system) {
    for (const equation of system.equations) {
        const term = equation.terms.find((t) => t.term === 'lorentzForce');
        if (term) return term;
    }
    return null;
}

// The shape w(x, y) of a wave function's potential energy V = V0 w, from the
// term that carries it, or null.
function drawPotentialEnergyShape(system) {
    for (const equation of system.equations) {
        const term = equation.terms.find((t) => t.term === 'proportionalSource' && t.weight
            && (equation.field === 'waveReal' || equation.field === 'waveImaginary'));
        if (term) return term.weight;
    }
    return null;
}

// The face pair the arrows and the flux view read: the flux pair where the
// system solves it, the velocity otherwise.
function drawVectorPair(system) {
    return drawSolvedFields(system).has('fluxX')
        ? { x: 'fluxX', y: 'fluxY' } : { x: 'xVelocity', y: 'yVelocity' };
}

// The field row

// The equations with a bounded advection term, which carries the diffusivity
// the cell-number views are keyed to. Per field, because each field has its own.
function drawAdvectedEquations(system) {
    return system.equations
        .map((equation) => ({ equation, term: equation.terms.find((t) => t.term === 'advection') }))
        .filter(({ term }) => term && term.diffusivity !== undefined);
}

// The fields the residual view can show, first one the default. Centers only,
// since the view samples centers.
function drawResidualFields(system) {
    return system.equations
        .filter((equation) => equation.location === CENTER)
        .map((equation) => equation.field);
}

// The draw shader

// The shader, section by section. `settings` is displaySettings with the
// system, the workgroup size and the case's display scales added (runtime.js).
function makeDrawCode(plate, settings) {
    const shader = drawShaderInputs(plate, settings);
    return [
        drawPixelToCellCode(),
        drawSamplingCode(shader),
        drawStreamlineCode(shader),
        drawPotentialCode(shader),
        drawHatchingCode(shader),
        drawColorCode(shader),
        drawBoundaryTypeCode(shader),
        drawCellNumberCode(shader),
        drawResidualCode(shader),
        drawArrowCode(shader),
        drawKernelCode(shader),
    ].join('\n');
}

// What the sections read beyond the settings: the plate, and the step the
// Courant view divides by, which is the momentum rows' own.
function drawShaderInputs(plate, settings) {
    const stepping = settings.system.equations.find((equation) => equation.field === 'xVelocity')
        || settings.system.equations[0];
    // What the picture may read: the fields the page allocates for this
    // system, and of those only what the plate holds. A check's plate holds
    // every field, and still gets the same picture.
    const allocated = new Set(plate.fieldArrays.map((array) => array.name));
    const wanted = new Set(simulationFields(settings.system));
    return { plate, settings, system: settings.system, courantStep: stepping.timeStep,
        has: (field) => allocated.has(field) && wanted.has(field) };
}

// Whether the plate holds every array a view's arm reads. An arm that cannot
// be drawn is never offered, and is written as plain white so that it reads no
// array the case did not allocate.
function drawArmDrawable(name, shader) {
    if (name === 'divergence') return shader.has('divergence');
    const need = viewsRecord(name).needs;
    if (!need) return true;
    if (need.allOf && !need.allOf.every(shader.has)) return false;
    if (need.anyOf && !need.anyOf.some(shader.has)) return false;
    return true;
}

function drawModeSelector(name) { return `${VIEW_NAMES.indexOf(name)}u`; }

// The line a view opens with when a value it reads may have blown up: drawn as
// the broken pattern and nothing else.
function drawBrokenGuard(...values) {
    const test = values.map((value) => `drawIsBroken(${value})`).join(' || ');
    return `if (${test}) { textureStore(canvasTexture, id.xy, drawBrokenColor(id)); return; }`;
}

// A center-shaped constant name for a field's bilinear base, such as
// DRAW_BASE_SPECIES_A.
function drawBaseName(field) {
    return `DRAW_BASE_${field.replace(/([A-Z])/g, '_$1').toUpperCase()}`;
}

// The average of a face pair at a cell's center, as WGSL.
function drawFaceAverage(xField, yField) {
    return `vec2f(
                (xFace.${xField}[indexXFace(level, cell.x, cell.y)] + xFace.${xField}[indexXFace(level, cell.x + 1u, cell.y)]) * 0.5,
                (yFace.${yField}[indexYFace(level, cell.x, cell.y)] + yFace.${yField}[indexYFace(level, cell.x, cell.y + 1u)]) * 0.5)`;
}

// A color as an opaque vec4f.
function drawOpaque(color) {
    return `vec4f(${[...color, 1].map(wgslLiteral).join(', ')})`;
}

// Pixel to cell

function drawPixelToCellCode() {
    // language=WGSL
    return `
        // Mapped to the interior, not to the array, so the picture stays the
        // same size when the view level changes.
        fn drawInteriorCoordinate(pixel : vec2f) -> vec2f {
            let canvasSize = textureDimensions(canvasTexture);
            return pixel / vec2f(canvasSize);
        }

        fn drawCellAt(pixel : vec2f) -> vec2u {
            let level = controls.viewLevel;
            let interiorCells = f32(grid.interior[level]);
            let uv = drawInteriorCoordinate(pixel);
            let cell = vec2u(floor(uv * interiorCells));
            return vec2u(min(cell.x, grid.interior[level] - 1u) + 1u,
                         min(cell.y, grid.interior[level] - 1u) + 1u);
        }
`;
}

// Sampling

// Every bilinear sampler is drawBilinearPoints then drawBilinearMix: one
// rule, with an offset per storage location. A location's first point sits
// `offset` cells from the domain edge (a center at 0.5, a face or a corner on
// the edge at 1.0, counting from the ghost ring), and it has `extra` more
// points than cells along an axis. Clamped to the interior, never the ghost
// ring.
function drawSamplingCode(shader) {
    const faceSampler = (name, field, axis) => {
        const x = axis === 'x';
        const array = x ? 'xFace' : 'yFace';
        const index = x ? 'indexXFace' : 'indexYFace';
        // language=WGSL
        return `
        fn ${name}(pixel : vec2f) -> f32 {
            let level = controls.viewLevel;
            let points = drawBilinearPoints(pixel, ${x ? 'vec2f(1.0, 0.5), vec2i(1, 0)' : 'vec2f(0.5, 1.0), vec2i(0, 1)'});
            return drawBilinearMix(points,
                ${array}.${field}[${index}(level, points.low.x, points.low.y)],
                ${array}.${field}[${index}(level, points.high.x, points.low.y)],
                ${array}.${field}[${index}(level, points.low.x, points.high.y)],
                ${array}.${field}[${index}(level, points.high.x, points.high.y)]);
        }`;
    };
    // language=WGSL
    return `
        // The four points around a sample, as their low and high column and
        // row, and the weights between them.
        struct DrawBilinear { low : vec2u, high : vec2u, weight : vec2f }

        fn drawBilinearPoints(pixel : vec2f, offset : vec2f, extra : vec2i) -> DrawBilinear {
            let level = controls.viewLevel;
            let interiorCells = f32(grid.interior[level]);
            let position = drawInteriorCoordinate(pixel) * interiorCells + offset;
            let low = vec2i(floor(position));
            let last = vec2i(i32(grid.interior[level])) + extra;
            return DrawBilinear(vec2u(clamp(low, vec2i(1), last)),
                                vec2u(clamp(low + vec2i(1), vec2i(1), last)),
                                position - vec2f(low));
        }

        fn drawBilinearMix(points : DrawBilinear, lowLow : f32, highLow : f32,
                           lowHigh : f32, highHigh : f32) -> f32 {
            return mix(mix(lowLow, highLow, points.weight.x),
                       mix(lowHigh, highHigh, points.weight.x), points.weight.y);
        }

        // The view's value, smoothed or the cell's own, by the viewer's switch.
        fn drawBilinearIfOn(nearest : f32, smoothed : f32) -> f32 {
            return select(nearest, smoothed, controls.bilinear != 0u);
        }

        fn drawVectorBilinearIfOn(nearest : vec2f, smoothed : vec2f) -> vec2f {
            return select(nearest, smoothed, controls.bilinear != 0u);
        }

        fn drawSampleCenter(pixel : vec2f, base : u32) -> f32 {
            let points = drawBilinearPoints(pixel, vec2f(0.5), vec2i(0));
            return drawBilinearMix(points,
                drawCenterValue(base, points.low.x, points.low.y),
                drawCenterValue(base, points.high.x, points.low.y),
                drawCenterValue(base, points.low.x, points.high.y),
                drawCenterValue(base, points.high.x, points.high.y));
        }
${shader.has('xVelocity') ? faceSampler('drawSampleXVelocity', 'xVelocity', 'x') : ''}
${shader.has('yVelocity') ? faceSampler('drawSampleYVelocity', 'yVelocity', 'y') : ''}
${shader.has('fluxX') ? faceSampler('drawSampleXFlux', 'fluxX', 'x') : ''}
${shader.has('fluxY') ? faceSampler('drawSampleYFlux', 'fluxY', 'y') : ''}
${shader.has('xVelocity') && shader.has('yVelocity') ? drawVorticitySamplerCode() : ''}`;
}

// A contour line, shared by the streamlines and every set of equipotentials.
function drawContourCode(shader) {
    const { settings } = shader;
    // language=WGSL
    return `
        // A line of constant width at every multiple of the interval: the
        // distance to the nearest multiple, over the field's change per pixel.
        // The ink is chosen against the color under it, since a line carries
        // nothing in its own color.
        fn drawContour(color : vec3f, here : f32, right : f32, below : f32, interval : f32) -> vec3f {
            if (!(interval > 0.0)) { return color; }
            let slope = length(vec2f(right - here, below - here)) / interval;
            if (!(slope > 0.0)) { return color; }
            let f = fract(here / interval);
            let distance = min(f, 1.0 - f) / slope;
            let half = 0.5 * ${wgslLiteral(settings.contourWidth)} * max(controls.hatchScale, 0.05);
            let coverage = clamp(half + 0.5 - distance, 0.0, 1.0);
            if (coverage <= 0.0) { return color; }
            let luminance = dot(color, vec3f(0.2126, 0.7152, 0.0722));
            let ink = select(vec3f(1.0), vec3f(0.0), luminance > ${wgslLiteral(settings.contourInkLuminance)});
            return mix(color, ink, ${wgslLiteral(settings.contourOpacity)} * coverage);
        }`;
}

// From the corners, where vorticity is evaluated.
function drawVorticitySamplerCode() {
    // language=WGSL
    return `
        fn drawSampleVorticity(pixel : vec2f) -> f32 {
            let level = controls.viewLevel;
            let points = drawBilinearPoints(pixel, vec2f(1.0), vec2i(1));
            return drawBilinearMix(points,
                vorticityAtCorner(level, points.low.x, points.low.y),
                vorticityAtCorner(level, points.high.x, points.low.y),
                vorticityAtCorner(level, points.low.x, points.high.y),
                vorticityAtCorner(level, points.high.x, points.high.y));
        }`;
}

// Streamlines and contours

// psi is summed from the face values along the top row, then down each column
// (y runs down, so d(psi)/dy = u and d(psi)/dx = -v), and held at the corners
// in a center-shaped display array, corner (column, row) in slot (column, row).
// Written only where the stream function is allocated, which is where
// divergenceFreePair offers a pair; the frame loop dispatches them on the same test.
function drawStreamlineCode(shader) {
    const { settings } = shader;
    if (!shader.has('streamFunction')) return drawContourCode(shader);
    const stream = divergenceFreePair(shader.system) || { x: 'xVelocity', y: 'yVelocity' };
    // language=WGSL
    return `
        @compute @workgroup_size(1)
        fn drawStreamRow() {
            let level = controls.viewLevel;
            let interiorCells = grid.interior[level];
            let spacing = grid.spacing[level];
            atomicStore(&controls.streamMaxBits, 0u);
            var psi = 0.0;
            centerState.streamFunction[indexCenter(level, 1u, 1u)] = psi;
            for (var column = 1u; column <= interiorCells; column = column + 1u) {
                psi = psi - yFace.${stream.y}[indexYFace(level, column, 1u)] * spacing;
                centerState.streamFunction[indexCenter(level, column + 1u, 1u)] = psi;
            }
        }

        @compute @workgroup_size(${settings.workgroup}, 1)
        fn drawStreamColumns(@builtin(global_invocation_id) id : vec3u) {
            let level = controls.viewLevel;
            let interiorCells = grid.interior[level];
            let column = id.x + 1u;
            if (column > interiorCells + 1u) { return; }
            let spacing = grid.spacing[level];
            var psi = centerState.streamFunction[indexCenter(level, column, 1u)];
            var largest = abs(psi);
            for (var row = 1u; row <= interiorCells; row = row + 1u) {
                psi = psi + xFace.${stream.x}[indexXFace(level, column, row)] * spacing;
                centerState.streamFunction[indexCenter(level, column, row + 1u)] = psi;
                largest = max(largest, abs(psi));
            }
            atomicMax(&controls.streamMaxBits, bitcast<u32>(largest));
        }

        fn drawSampleStream(pixel : vec2f) -> f32 {
            let level = controls.viewLevel;
            let points = drawBilinearPoints(pixel, vec2f(1.0), vec2i(1));
            return drawBilinearMix(points,
                centerState.streamFunction[indexCenter(level, points.low.x, points.low.y)],
                centerState.streamFunction[indexCenter(level, points.high.x, points.low.y)],
                centerState.streamFunction[indexCenter(level, points.low.x, points.high.y)],
                centerState.streamFunction[indexCenter(level, points.high.x, points.high.y)]);
        }` + drawContourCode(shader);
}

// Potential and current

// Where the system carries the Lorentz force it solves the induced part a, and
// the field lines are contours of the total A = A0 + a: the applied part, B0 y
// for a field along x and -B0 x along y, is added back at each pixel.
function drawPotentialCode(shader) {
    const shape = drawPotentialEnergyShape(shader.system);
    const lorentz = drawLorentzTerm(shader.system);
    const applied = lorentz ? coefficientCodeOf(lorentz.applied) : '0.0';
    const appliedAt = !lorentz ? '0.0'
        : lorentz.along === 'x' ? `${applied} * uv.y` : `(-${applied}) * uv.x`;
    // language=WGSL
    return `
        fn drawAppliedPotential(pixel : vec2f) -> f32 {
            let uv = drawInteriorCoordinate(pixel);
            return ${appliedAt};
        }

        // A wave function's potential energy shape, read where the solver
        // reads it, at cell centers on the level shown, then drawn as every
        // center field is: the cell's own value, or smoothed between the four
        // centers around the pixel when bilinear is on.
        fn drawPotentialShapeOfCell(cell : vec2u) -> f32 {
            let position = (vec2f(cell) - vec2f(0.5)) * grid.spacing[controls.viewLevel];
            return ${shape ? shape.wgsl : '0.0 * position.x'};
        }

        fn drawPotentialShapeAt(pixel : vec2f) -> f32 {
            let points = drawBilinearPoints(pixel, vec2f(0.5), vec2i(0));
            let smoothed = drawBilinearMix(points,
                drawPotentialShapeOfCell(points.low),
                drawPotentialShapeOfCell(vec2u(points.high.x, points.low.y)),
                drawPotentialShapeOfCell(vec2u(points.low.x, points.high.y)),
                drawPotentialShapeOfCell(points.high));
            return drawBilinearIfOn(drawPotentialShapeOfCell(drawCellAt(pixel)), smoothed);
        }

${shader.has('potential') ? `
        // The current out of the plane, j = -lap A, at a cell center. The
        // applied part is linear and adds nothing. A center on the ghost ring
        // is replaced by its interior neighbor, as the force does.
        fn drawCurrentAt(level : u32, column : u32, row : u32) -> f32 {
            let interiorCells = grid.interior[level];
            let clampedColumn = clamp(column, 1u, interiorCells);
            let clampedRow = clamp(row, 1u, interiorCells);
            let spacing = grid.spacing[level];
            return -(drawCenterValue(DRAW_BASE_POTENTIAL, clampedColumn + 1u, clampedRow)
                + drawCenterValue(DRAW_BASE_POTENTIAL, clampedColumn - 1u, clampedRow)
                + drawCenterValue(DRAW_BASE_POTENTIAL, clampedColumn, clampedRow + 1u)
                + drawCenterValue(DRAW_BASE_POTENTIAL, clampedColumn, clampedRow - 1u)
                - 4.0 * drawCenterValue(DRAW_BASE_POTENTIAL, clampedColumn, clampedRow)) / (spacing * spacing);
        }

        fn drawSampleCurrent(pixel : vec2f) -> f32 {
            let level = controls.viewLevel;
            let points = drawBilinearPoints(pixel, vec2f(0.5), vec2i(0));
            return drawBilinearMix(points,
                drawCurrentAt(level, points.low.x, points.low.y),
                drawCurrentAt(level, points.high.x, points.low.y),
                drawCurrentAt(level, points.low.x, points.high.y),
                drawCurrentAt(level, points.high.x, points.high.y));
        }` : ''}`;
}

// Hatching

// One direction per pixel, chosen by what the color means in the view, and a
// symmetric swing in lightness that keeps the hue. The period is in screen
// pixels, converted through hatchScale.
function drawHatchingCode(shader) {
    const { settings } = shader;
    const speciesHatchCalls = DRAW_SPECIES_FIELDS
        .map((field, k) => `            out = drawHatch(id, out, DRAW_HATCH_${settings.speciesHatches[k].toUpperCase()}, `
            + `presence * amount[${k}] / total);`)
        .join('\n');
    // language=WGSL
    return `
        const DRAW_HATCH_NONE       : u32 = 0u;
        const DRAW_HATCH_VERTICAL   : u32 = 1u;   // phase along x, stripes upright
        const DRAW_HATCH_HORIZONTAL : u32 = 2u;   // phase along y, stripes flat
        const DRAW_HATCH_RISING     : u32 = 3u;   // "/" as drawn
        const DRAW_HATCH_FALLING    : u32 = 4u;   // "\\" as drawn

        fn drawHatch(id : vec3u, color : vec3f, direction : u32, amount : f32) -> vec3f {
            if (direction == DRAW_HATCH_NONE || amount <= 0.0) { return color; }
            let pixel = vec2f(id.xy);
            var phase = pixel.x;
            if (direction == DRAW_HATCH_HORIZONTAL) {
                phase = pixel.y;
            } else if (direction == DRAW_HATCH_RISING) {
                phase = (pixel.x + pixel.y) * 0.70710678;
            } else if (direction == DRAW_HATCH_FALLING) {
                phase = (pixel.x - pixel.y) * 0.70710678;
            }
            let k = 6.2831853 / (max(controls.hatchPitch, 2.0) * max(controls.hatchScale, 0.05));
            let swing = controls.hatchDepth * amount * sin(k * phase);
            return select(mix(color, vec3f(0.0), -swing),
                          mix(color, vec3f(1.0), swing), swing >= 0.0);
        }

        // A direction per species present, the depth split by share, so a
        // mixture reads as a weave and purity, not amount, sets the stripes.
        fn drawSpeciesHatched(id : vec3u, color : vec3f, amount : vec4f) -> vec3f {
            let total = amount.x + amount.y + amount.z + amount.w;
            if (total <= 0.0) { return color; }
            let top = max(max(amount.x, amount.y), max(amount.z, amount.w));
            let presence = clamp(top / ${wgslLiteral(settings.accessibleFloor)}, 0.0, 1.0);
            var out = color;
${speciesHatchCalls}
            return out;
        }

        // Stripes along the vector, its angle folded onto a half turn and
        // binned to four axes. y runs down, so 45 degrees is the falling
        // diagonal. The sense along the axis is what the arrows give.
        fn drawDirectionHatch(vector : vec2f, scale : f32) -> vec2f {
            let size = sqrt(vector.x * vector.x + vector.y * vector.y);
            if (size <= 0.0) { return vec2f(f32(DRAW_HATCH_NONE), 0.0); }
            let amount = clamp(size / scale, 0.0, 1.0);
            var angle = atan2(vector.y, vector.x);
            if (angle < 0.0) { angle = angle + 3.14159265; }
            let bin = u32(floor(angle / 0.78539816 + 0.5)) % 4u;
            var direction = DRAW_HATCH_HORIZONTAL;
            if (bin == 1u) { direction = DRAW_HATCH_FALLING; }
            if (bin == 2u) { direction = DRAW_HATCH_VERTICAL; }
            if (bin == 3u) { direction = DRAW_HATCH_RISING; }
            return vec2f(f32(direction), amount);
        }

        fn drawSignedHatch(value : f32, amount : f32) -> vec2f {
            if (amount <= 0.0) { return vec2f(f32(DRAW_HATCH_NONE), 0.0); }
            let direction = select(DRAW_HATCH_FALLING, DRAW_HATCH_RISING, value > 0.0);
            return vec2f(f32(direction), amount);
        }

        fn drawSignedLinearHatch(value : f32, scale : f32) -> vec2f {
            return drawSignedHatch(value, abs(clamp(value / scale, -1.0, 1.0)));
        }`;
}

// Color

function drawColorCode(shader) {
    const { settings } = shader;
    const speciesHues = drawSpeciesHues(settings);
    const speciesHueSum = DRAW_SPECIES_FIELDS
        .map((field, k) => `amount[${k}] * ${wgslColor(speciesHues[k])}`).join('\n                     + ');
    const warm = wgslColor(settings.signedWarm);
    const cool = wgslColor(settings.signedCool);
    const neutral = wgslColor(settings.darkNeutral);
    // language=WGSL
    return `
        fn drawTemperatureColor(value : f32) -> vec4f {
            let normalized = value / ${wgslLiteral(settings.maxTemperature)};
            let color = select(normalized * ${wgslColor(settings.temperatureHot)}, ${wgslColor(settings.temperatureCold)},
                normalized < ${wgslLiteral(settings.coldThreshold)});
            return vec4f(color, 1.0);
        }

        // color = mix(white, sum_k s_k h_k, min(total, 1)), s_k = c_k / total,
        // on amounts already divided by each species' full scale.
        fn drawSpeciesColor(amount : vec4f) -> vec4f {
            let total = amount.x + amount.y + amount.z + amount.w;
            if (total <= 0.0) { return vec4f(1.0, 1.0, 1.0, 1.0); }
            let hue = (${speciesHueSum}) / total;
            return vec4f(mix(vec3f(1.0), hue, clamp(total, 0.0, 1.0)), 1.0);
        }

        // A position in orders of magnitude above a floor, as a fraction of
        // the ramp, so a view reads the same at 1e-3 and at 1e-9.
        fn drawDecades(magnitude : f32, floorValue : f32, decades : f32) -> f32 {
            return clamp(log(magnitude / floorValue) / log(10.0) / decades, 0.0, 1.0);
        }

        fn drawDivergenceColor(value : f32) -> vec4f {
            let magnitude = abs(value);
            if (magnitude <= ${wgslLiteral(settings.divergenceThreshold)}) {
                return vec4f(${wgslColor(settings.divergenceMet)}, 1.0);
            }
            let t = drawDecades(magnitude, ${wgslLiteral(settings.divergenceThreshold)}, ${wgslLiteral(settings.divergenceDecades)});
            return vec4f(select(${cool}, ${warm}, value > 0.0) * t, 1.0);
        }

        // Out of a light neutral, so a weak vortex is tinted and not lost.
        // Warm is clockwise on screen (vorticityAtCorner in operators.js).
        fn drawVorticityColor(value : f32) -> vec4f {
            let t = drawDecades(abs(value), ${wgslLiteral(settings.vorticityFloor)}, ${wgslLiteral(settings.vorticityDecades)});
            return vec4f(mix(${wgslColor(settings.signedLight)}, select(${cool}, ${warm}, value > 0.0), t), 1.0);
        }

        fn drawResidualColor(value : f32) -> vec4f {
            let magnitude = abs(value);
            if (magnitude <= ${wgslLiteral(settings.residualFloor)}) {
                return vec4f(${wgslColor(settings.residualFloorColor)}, 1.0);
            }
            let t = drawDecades(magnitude, ${wgslLiteral(settings.residualFloor)}, ${wgslLiteral(settings.residualDecades)});
            return vec4f(${wgslColor(settings.residualColor)} * t, 1.0);
        }

        // Linear and signed, for a field that spans one range.
        fn drawSignedLinearColor(value : f32, scale : f32) -> vec4f {
            let t = clamp(value / scale, -1.0, 1.0);
            return vec4f(select(mix(${neutral}, ${cool}, -t), mix(${neutral}, ${warm}, t), t >= 0.0), 1.0);
        }

        // Hue is direction, on turns so a full turn lands on the color zero
        // does.
        fn drawDirectionHue(vector : vec2f) -> vec3f {
            var turns = atan2(vector.y, vector.x) * 0.15915494;
            turns = turns - floor(turns);
            let scaled = turns * 3.0;
            let sector = u32(scaled) % 3u;
            let f = scaled - floor(scaled);
            if (sector == 0u) { return vec3f(1.0 - f, f, 0.0); }
            if (sector == 1u) { return vec3f(0.0, 1.0 - f, f); }
            return vec3f(f, 0.0, 1.0 - f);
        }

        // Saturation is size against a peak, under a square root.
        fn drawDirectionColor(vector : vec2f, peak : f32) -> vec4f {
            let size = sqrt(vector.x * vector.x + vector.y * vector.y);
            let saturation = sqrt(clamp(size / peak, 0.0, 1.0));
            return vec4f(mix(${neutral}, drawDirectionHue(vector), saturation), 1.0);
        }

        // Against the peak the solver measured on this level; the cutoff, off
        // by default, blanks what is below a fraction of it.
        fn drawVelocityColor(velocity : vec2f) -> vec4f {
            let speed = sqrt(velocity.x * velocity.x + velocity.y * velocity.y);
            let peak = max(controls.velocityMax[controls.viewLevel], 1.0e-12);
            if (controls.velocityCutoff > 0.0 && speed < controls.velocityCutoff * peak) {
                return vec4f(${neutral}, 1.0);
            }
            return drawDirectionColor(velocity, peak);
        }

        // A value that is NaN or past 1e6 gets a pattern of its own, so it
        // cannot pass for a zero.
        fn drawIsBroken(value : f32) -> bool {
            return value != value || abs(value) > 1.0e6;
        }

        fn drawBrokenColor(id : vec3u) -> vec4f {
            let stripe = ((id.x + id.y) / 8u) % 2u;
            return select(${drawOpaque(settings.brokenLight)}, ${drawOpaque(settings.brokenDark)}, stripe == 0u);
        }`;
}

// Boundary type

// The one view that maps the whole array, ghost ring included, giving the ring
// a pixel of its own on each side.
function drawBoundaryTypeCode(shader) {
    const { settings } = shader;
    // The last color is the default arm, so an unknown type still draws.
    const typeCases = settings.boundaryColors.map((color, k) => {
        const arm = (k === settings.boundaryColors.length - 1) ? 'default:' : `case ${k}: `;
        return `                ${arm} { return ${drawOpaque(color)}; }   // ${BOUNDARY_NAMES[k]}`;
    }).join('\n');
    // language=WGSL
    return `
        fn drawTypeCell(id : vec3u) -> vec2u {
            let level = controls.viewLevel;
            let interiorCells = grid.interior[level];
            let canvasSize = textureDimensions(canvasTexture);
            let pixel = vec2i(id.xy);
            let last = vec2i(canvasSize) - vec2i(1, 1);

            var cell = vec2i(0, 0);
            let inner = vec2f(pixel - vec2i(1, 1)) / vec2f(last - vec2i(1, 1));
            let interior = vec2i(floor(inner * f32(interiorCells))) + vec2i(1, 1);

            cell.x = select(min(interior.x, i32(interiorCells)), 0, pixel.x == 0);
            cell.y = select(min(interior.y, i32(interiorCells)), 0, pixel.y == 0);
            cell.x = select(cell.x, i32(interiorCells) + 1, pixel.x == last.x);
            cell.y = select(cell.y, i32(interiorCells) + 1, pixel.y == last.y);
            return vec2u(cell);
        }

        // The type arrays are i32, so the arms are bare integers.
        fn drawTypeColor(cell : vec2u) -> vec4f {
            let level = controls.viewLevel;
            let p = indexCenter(level, cell.x, cell.y);
            let kind = grid.typeCenter[p];
            switch kind {
${typeCases}
            }
        }`;
}

// Cell numbers

// The cell Peclet number, the upwind blend and the Courant number, evaluated
// at cell centers from the face-averaged velocity. Each advected field's
// diffusivity arm goes through the resolver the dictionary uses, so a slider
// moves the picture as it moves the solver; a system with no advection gets
// one arm returning one, and is never offered these views.
function drawCellNumberCode(shader) {
    const advected = drawAdvectedEquations(shader.system);
    const diffusivityCases = advected.length === 0
        ? '                default { return 1.0; }'
        : advected.map(({ term }, index) => {
            const selector = index === 0 ? 'case 0u, default' : `case ${index}u:`;
            return `                ${selector} { return ${coefficientCodeOf(term.diffusivity)}; }`;
        }).join('\n');
    // language=WGSL
    return `
        fn drawDiffusivityOf(field : u32) -> f32 {
            switch field {
${diffusivityCases}
            }
        }

${shader.has('xVelocity') && shader.has('yVelocity') ? `
        fn drawCellVelocity(cell : vec2u) -> vec2f {
            let level = controls.viewLevel;
            return vec2f(xFaceToCenter(level, cell.x, cell.y), yFaceToCenter(level, cell.x, cell.y));
        }` : ''}`;
}

// Residual

// controls.viewField picks the field; the first is the default arm.
function drawResidualCode(shader) {
    const fields = drawResidualFields(shader.system);
    const arm = (name) => `{ return centerWorkspace.${name}Residual[p]; }`;
    const cases = fields
        .map((name, index) => (index === 0 ? null : `                case ${index}u:`.padEnd(29) + ` ${arm(name)}`))
        .filter(Boolean)
        .concat(`                case 0u, default ${arm(fields[0])}`)
        .join('\n');
    // language=WGSL
    return `
        fn drawResidualAt(cell : vec2u) -> f32 {
            let level = controls.viewLevel;
            let p = indexCenter(level, cell.x, cell.y);
            switch controls.viewField {
${cases}
            }
        }`;
}

// Direction arrows

// A glyph per screen-pixel cell of the arrow pitch, sampled once at its own
// center, drawn as a light body in a dark outline, its length the square root
// of the vector's size against a peak.
function drawArrowCode(shader) {
    const { settings } = shader;
    const vector = drawVectorPair(shader.system);
    // With no vector allocated there is nothing to point.
    if (!shader.has(vector.x) || !shader.has(vector.y)) {
        // language=WGSL
        return `
        fn drawArrows(pixel : vec2f, color : vec3f) -> vec3f { return color; }`;
    }
    const sampler = { xVelocity: 'drawSampleXVelocity', yVelocity: 'drawSampleYVelocity',
                      fluxX: 'drawSampleXFlux', fluxY: 'drawSampleYFlux' };
    // The measured peak speed for a velocity; the case's scale for a flux,
    // which has no scan of its own.
    const peak = vector.x === 'xVelocity' ? 'controls.velocityMax[level]' : wgslLiteral(settings.fluxScale);
    // language=WGSL
    return `
        const DRAW_ARROW_LONG  : f32 = 0.86;   // longest glyph, as a fraction of the pitch
        const DRAW_ARROW_SHORT : f32 = 0.34;   // shortest
        const DRAW_ARROW_HEAD  : f32 = 0.34;   // head length, as a fraction of the glyph
        const DRAW_ARROW_SHAFT : f32 = 0.075;  // shaft half width, likewise
        const DRAW_ARROW_BARB  : f32 = 0.19;   // head half width at the barbs
        const DRAW_ARROW_EDGE  : f32 = 1.6;    // outline width, in canvas pixels

        // Coverage of the glyph grown by \`grow\` pixels, with x along the arrow
        // and y across it, feathered over one pixel.
        fn drawArrowCoverage(along : f32, across : f32, half : f32, head : f32,
                             shaft : f32, barb : f32, grow : f32) -> f32 {
            let taper = barb * clamp((half + grow - along) / head, 0.0, 1.0);
            let width = select(shaft, taper, along > half - head) + grow;
            let ends = min(along + half + grow, half + grow - along);
            return clamp(min(ends, width - across) + 0.5, 0.0, 1.0);
        }

        fn drawArrows(pixel : vec2f, color : vec3f) -> vec3f {
            let level = controls.viewLevel;
            let pitch = max(controls.arrowPitch, 10.0) * max(controls.hatchScale, 0.05);
            let center = (floor(pixel / pitch) + vec2f(0.5)) * pitch;

            let cell = drawCellAt(center);
            if (grid.typeCenter[indexCenter(level, cell.x, cell.y)] != FLUID) { return color; }

            let vector = drawVectorBilinearIfOn(${drawFaceAverage(vector.x, vector.y)},
                vec2f(${sampler[vector.x]}(center), ${sampler[vector.y]}(center)));
            if (drawIsBroken(vector.x) || drawIsBroken(vector.y)) { return color; }

            let size = sqrt(vector.x * vector.x + vector.y * vector.y);
            if (size <= 0.0) { return color; }
            let peak = max(${peak}, 1.0e-12);
            let fraction = clamp(size / peak, 0.0, 1.0);
            // Below the cutoff the color is already neutral, and below the
            // floor the direction is rounding noise.
            if (fraction < max(controls.velocityCutoff, ${wgslLiteral(settings.arrowFloor)})) { return color; }

            // Screen y and the row both run down, so no sign flips.
            let forward = vector / size;
            let sideways = vec2f(-forward.y, forward.x);
            let offset = pixel - center;
            let along = dot(offset, forward);
            let across = abs(dot(offset, sideways));

            let full = pitch * (DRAW_ARROW_SHORT + (DRAW_ARROW_LONG - DRAW_ARROW_SHORT) * sqrt(fraction));
            let half = full * 0.5;
            let head = full * DRAW_ARROW_HEAD;
            let shaft = max(full * DRAW_ARROW_SHAFT, 0.7);
            let barb = max(full * DRAW_ARROW_BARB, 1.6);

            let body = drawArrowCoverage(along, across, half, head, shaft, barb, 0.0);
            let outline = drawArrowCoverage(along, across, half, head, shaft, barb, DRAW_ARROW_EDGE);
            if (outline <= 0.0) { return color; }

            let outlined = mix(color, ${wgslColor(settings.arrowOutline)}, outline * ${wgslLiteral(settings.arrowOpacity)});
            return mix(outlined, ${wgslColor(settings.arrowBody)}, body * ${wgslLiteral(settings.arrowOpacity)});
        }`;
}

// The kernel

// One arm per view, in the order of VIEWS, written by drawViewArms. Each arm
// sets the color and what a hatch would mean in it; the hatch, the streamlines
// and the arrows are laid over whatever it produced, and there is one store at
// the end.
function drawKernelCode(shader) {
    const { settings } = shader;
    const arms = drawViewArms(shader);
    const switchArms = VIEW_NAMES.map((name) => {
        const selector = name === 'species' ? `case ${drawModeSelector(name)}, default` : `case ${drawModeSelector(name)}:`;
        // language=WGSL
        const arm = drawArmDrawable(name, shader) ? arms[name] : `
                    color = vec4f(1.0, 1.0, 1.0, 1.0);`;
        return `                ${selector} {   // ${name}${arm}
                }`;
    }).join('\n');
    const notFieldView = (name) => `controls.viewMode != ${drawModeSelector(name)}`;
    // Solid cells, the hatch and the streamlines belong to pictures of a field.
    const fieldViewsOnly = VIEWS.filter((view) => view.fieldView === false)
        .map((view) => notFieldView(view.name)).join(' && ');
    const streamInterval =
        'bitcast<f32>(atomicLoad(&controls.streamMaxBits)) / max(round(controls.contourCount), 1.0)';
    // language=WGSL
    return `
        @compute @workgroup_size(${settings.workgroup}, ${settings.workgroup})
        fn drawField(@builtin(global_invocation_id) id : vec3u) {
            let canvasSize = textureDimensions(canvasTexture);
            if (id.x >= canvasSize.x || id.y >= canvasSize.y) { return; }

            let level = controls.viewLevel;
            let pixel = vec2f(id.xy);
            let cell = drawCellAt(pixel);
            let p = indexCenter(level, cell.x, cell.y);

            // Solid cells are solid in every field view; the boundary types
            // and the coordinate test pattern are not field views.
            if (grid.typeCenter[p] != FLUID && ${fieldViewsOnly}) {
                textureStore(canvasTexture, id.xy, vec4f(${wgslColor(settings.solidColor)}, 1.0));
                return;
            }

            var color = vec4f(0.0, 0.0, 0.0, 1.0);
            var hatch = vec2f(f32(DRAW_HATCH_NONE), 0.0);

            switch controls.viewMode {
${switchArms}
            }

            if (controls.accessible != 0u) {
                color = vec4f(drawHatch(id, color.rgb, u32(hatch.x), hatch.y), color.a);
            }
${shader.has('streamFunction') ? `            // Streamlines under the arrows, so a glyph is never cut by a line.
            if (controls.streamlines != 0u && ${fieldViewsOnly}) {
                let interval = ${streamInterval};
                color = vec4f(drawContour(color.rgb, drawSampleStream(pixel),
                    drawSampleStream(pixel + vec2f(1.0, 0.0)),
                    drawSampleStream(pixel + vec2f(0.0, 1.0)), interval), color.a);
            }` : ''}
            // Never over the boundary types, which map the ghost ring too.
            if (controls.arrows != 0u && ${notFieldView('boundary type')}) {
                color = vec4f(drawArrows(pixel, color.rgb), color.a);
            }
            textureStore(canvasTexture, id.xy, color);
        }`;
}

// Each view's arm, by view name, indented to sit in the switch. Every arm
// reads its value, guards it, and sets `color` and `hatch`; each starts on a
// new line.
function drawViewArms(shader) {
    const { settings } = shader;
    const maxSpeed = wgslLiteral(settings.maxSpeed);
    const cellNumberDecades = wgslLiteral(settings.cellNumberDecades);
    const potentialScale = wgslLiteral(settings.potentialScale);
    const currentScale = wgslLiteral(settings.currentScale);
    const fluxScale = wgslLiteral(settings.fluxScale);
    const waveScale = wgslLiteral(settings.waveScale);
    const pressureScale = wgslLiteral(settings.pressureScale);
    const vorticityFloor = wgslLiteral(settings.vorticityFloor);
    const vorticityDecades = wgslLiteral(settings.vorticityDecades);
    const divergenceThreshold = wgslLiteral(settings.divergenceThreshold);
    const divergenceDecades = wgslLiteral(settings.divergenceDecades);
    // language=WGSL
    const waveFunction = `
                    let wave = vec2f(
                        drawBilinearIfOn(centerState.waveReal[p], drawSampleCenter(pixel, DRAW_BASE_WAVE_REAL)),
                        drawBilinearIfOn(centerState.waveImaginary[p], drawSampleCenter(pixel, DRAW_BASE_WAVE_IMAGINARY)));
                    ${drawBrokenGuard('wave.x', 'wave.y')}`;
    // The potential energy's equipotentials over either wave view, where the
    // case has one: twice its shape's midline value over the line count apart.
    // language=WGSL
    const potentialContours = drawPotentialEnergyShape(shader.system) ? `
                    if (controls.equipotentials != 0u) {
                        color = vec4f(drawContour(color.rgb, drawPotentialShapeAt(pixel),
                            drawPotentialShapeAt(pixel + vec2f(1.0, 0.0)), drawPotentialShapeAt(pixel + vec2f(0.0, 1.0)),
                            2.0 / max(round(controls.contourCount), 1.0)), 1.0);
                    }` : '';
    // Equipotentials are twice the scale over the line count apart; field
    // lines each carry the case's fieldLineScale over the count, so line
    // density is field strength.
    const contourInterval = drawLorentzTerm(shader.system)
        ? `${wgslLiteral(settings.fieldLineScale)} / max(round(controls.contourCount), 1.0)`
        : `2.0 * scale / max(round(controls.contourCount), 1.0)`;
    // language=WGSL
    const cellVelocity = `
                    let velocity = drawCellVelocity(cell);
                    ${drawBrokenGuard('velocity.x', 'velocity.y')}`;
    return {
        species: drawSpeciesArm(shader),
        // language=WGSL
        temperature: `
                    let raw = centerState.temperature[p];
                    ${drawBrokenGuard('raw')}
                    color = drawTemperatureColor(drawBilinearIfOn(raw, drawSampleCenter(pixel, DRAW_BASE_TEMPERATURE)));`,
        // language=WGSL
        velocity: `
                    let velocity = vec2f(
                        drawBilinearIfOn(xFaceToCenter(level, cell.x, cell.y), drawSampleXVelocity(pixel)),
                        drawBilinearIfOn(yFaceToCenter(level, cell.x, cell.y), drawSampleYVelocity(pixel)));
                    ${drawBrokenGuard('velocity.x', 'velocity.y')}
                    color = drawVelocityColor(velocity);
                    hatch = drawDirectionHatch(velocity, ${maxSpeed});`,
        // language=WGSL
        'x-velocity': `
                    let velocityX = drawBilinearIfOn(xFaceToCenter(level, cell.x, cell.y), drawSampleXVelocity(pixel));
                    ${drawBrokenGuard('velocityX')}
                    color = drawSignedLinearColor(velocityX, ${maxSpeed});
                    hatch = drawSignedLinearHatch(velocityX, ${maxSpeed});`,
        // language=WGSL
        'y-velocity': `
                    let velocityY = drawBilinearIfOn(yFaceToCenter(level, cell.x, cell.y), drawSampleYVelocity(pixel));
                    ${drawBrokenGuard('velocityY')}
                    color = drawSignedLinearColor(velocityY, ${maxSpeed});
                    hatch = drawSignedLinearHatch(velocityY, ${maxSpeed});`,
        // language=WGSL
        vorticity: `
                    let vorticity = drawBilinearIfOn(vorticityAtCenter(level, cell.x, cell.y), drawSampleVorticity(pixel));
                    ${drawBrokenGuard('vorticity')}
                    color = drawVorticityColor(vorticity);
                    hatch = drawSignedHatch(vorticity, drawDecades(abs(vorticity), ${vorticityFloor}, ${vorticityDecades}));`,
        // language=WGSL
        pressure: `
                    let raw = centerState.pressure[p];
                    ${drawBrokenGuard('raw')}
                    let value = drawBilinearIfOn(raw, drawSampleCenter(pixel, DRAW_BASE_PRESSURE));
                    color = drawSignedLinearColor(value, ${pressureScale});
                    hatch = drawSignedLinearHatch(value, ${pressureScale});`,
        // The contours come from the smoothed field whether or not bilinear is
        // on, since a line through cell values would trace the cell edges.
        // language=WGSL
        potential: `
                    let raw = centerState.potential[p];
                    ${drawBrokenGuard('raw')}
                    let smoothed = drawSampleCenter(pixel, DRAW_BASE_POTENTIAL);
                    let value = drawBilinearIfOn(raw, smoothed);
                    let scale = ${potentialScale};
                    color = drawSignedLinearColor(value, scale);
                    hatch = drawSignedLinearHatch(value, scale);
                    if (controls.equipotentials != 0u) {
                        let right = pixel + vec2f(1.0, 0.0);
                        let below = pixel + vec2f(0.0, 1.0);
                        color = vec4f(drawContour(color.rgb,
                            smoothed + drawAppliedPotential(pixel),
                            drawSampleCenter(right, DRAW_BASE_POTENTIAL) + drawAppliedPotential(right),
                            drawSampleCenter(below, DRAW_BASE_POTENTIAL) + drawAppliedPotential(below),
                            ${contourInterval}), 1.0);
                    }`,
        // language=WGSL
        current: `
                    let raw = drawCurrentAt(level, cell.x, cell.y);
                    ${drawBrokenGuard('raw')}
                    let value = drawBilinearIfOn(raw, drawSampleCurrent(pixel));
                    color = drawSignedLinearColor(value, ${currentScale});
                    hatch = drawSignedLinearHatch(value, ${currentScale});`,
        // language=WGSL
        flux: `
                    let flux = drawVectorBilinearIfOn(${drawFaceAverage('fluxX', 'fluxY')},
                        vec2f(drawSampleXFlux(pixel), drawSampleYFlux(pixel)));
                    ${drawBrokenGuard('flux.x', 'flux.y')}
                    color = drawDirectionColor(flux, ${fluxScale});
                    hatch = drawDirectionHatch(flux, ${fluxScale});`,
        // Phase as hue on the velocity view's wheel, amplitude as saturation.
        'wave function': `${waveFunction}
                    color = drawDirectionColor(wave, ${waveScale});
                    hatch = drawDirectionHatch(wave, ${waveScale});${potentialContours}`,
        // |psi|^2 against the case's scale squared. Magnitude in brightness,
        // so no hatch.
        'probability density': `${waveFunction}
                    let density = clamp(dot(wave, wave) / (${waveScale} * ${waveScale}), 0.0, 1.0);
                    color = vec4f(mix(${wgslColor(settings.darkNeutral)}, ${wgslColor(settings.densityLight)}, density), 1.0);${potentialContours}`,
        // language=WGSL
        divergence: `
                    let value = drawBilinearIfOn(centerState.divergence[p], drawSampleCenter(pixel, DRAW_BASE_DIVERGENCE));
                    color = drawDivergenceColor(value);
                    let over = abs(value) > ${divergenceThreshold};
                    hatch = drawSignedHatch(value, select(0.0, drawDecades(abs(value), ${divergenceThreshold}, ${divergenceDecades}), over));`,
        // Signed around 2 on a log scale. A field asked to diffuse at zero is
        // drawn at the top of the scale, which is pure upwind, what the blend
        // does with it.
        'cell Peclet': `${cellVelocity}
                    let diffusivity = drawDiffusivityOf(controls.viewField);
                    let peclet = select(1.0e6, length(velocity) * grid.spacing[level] / max(diffusivity, 1.0e-30),
                        diffusivity > 0.0);
                    let value = log(max(peclet, 1.0e-6) / 2.0) / log(10.0);
                    color = drawSignedLinearColor(value, ${cellNumberDecades});
                    hatch = drawSignedLinearHatch(value, ${cellNumberDecades});`,
        // 1 - gamma on whichever axis has more of it, gamma being advection's
        // own advectionBlend. Magnitude in brightness, so no hatch.
        'upwind blend': `${cellVelocity}
                    let spacing = grid.spacing[level];
                    let diffusivity = drawDiffusivityOf(controls.viewField);
                    let blendX = advectionBlend(velocity.x, diffusivity, spacing);
                    let blendY = advectionBlend(velocity.y, diffusivity, spacing);
                    let upwindShare = max(1.0 - blendX, 1.0 - blendY);
                    color = vec4f(mix(${wgslColor(settings.blendLight)}, ${wgslColor(settings.blendDark)}, upwindShare), 1.0);`,
        // Signed around 1 on a log scale. The stepping is implicit, so above
        // one is not unstable by itself.
        'Courant number': `${cellVelocity}
                    let courant = length(velocity) * ${wgslLiteral(shader.courantStep)} / grid.spacing[level];
                    let value = log(max(courant, 1.0e-6)) / log(10.0);
                    color = drawSignedLinearColor(value, ${cellNumberDecades});
                    hatch = drawSignedLinearHatch(value, ${cellNumberDecades});`,
        material: drawMaterialArm(shader),
        // language=WGSL
        residual: `
                    color = drawResidualColor(drawResidualAt(cell));`,
        // A hatch per type, since inlet green against outlet orange is the
        // red-green confusion. Wall keeps none.
        // language=WGSL
        'boundary type': `
                    let typeCell = drawTypeCell(id);
                    let kind = grid.typeCenter[indexCenter(level, typeCell.x, typeCell.y)];
                    color = drawTypeColor(typeCell);
                    var direction = DRAW_HATCH_NONE;
                    if (kind == INLET)    { direction = DRAW_HATCH_HORIZONTAL; }
                    if (kind == OUTLET)   { direction = DRAW_HATCH_RISING; }
                    if (kind == SYMMETRY) { direction = DRAW_HATCH_FALLING; }
                    if (kind == INERT)    { direction = DRAW_HATCH_VERTICAL; }
                    hatch = vec2f(f32(direction), 1.0);`,
        // A known gradient and a checker, the control for whether every pixel
        // was reached. Stored here, unhatched and with no overlays.
        // language=WGSL
        coordinates: `
                    let canvas = vec2f(textureDimensions(canvasTexture));
                    let checker = f32((((cell.x - 1u) / 8u) + ((cell.y - 1u) / 8u)) % 2u);
                    textureStore(canvasTexture, id.xy,
                        vec4f(f32(id.x) / canvas.x, f32(id.y) / canvas.y, checker, 1.0));
                    return;`,
    };
}

// Each species divided by its own full scale, the ones not chosen zeroed so a
// species keeps its mixture hue alone, and undershoot counted as none. A
// species the case does not allocate reads as none.
function drawSpeciesArm(shader) {
    const { settings } = shader;
    const held = DRAW_SPECIES_FIELDS.filter(shader.has);
    const broken = held.map((field) => `centerState.${field}[p]`);
    const nextArgument = ',\n                        ';
    const read = DRAW_SPECIES_FIELDS
        .map((field) => (shader.has(field)
            ? `drawBilinearIfOn(centerState.${field}[p], drawSampleCenter(pixel, ${drawBaseName(field)}))` : '0.0'))
        .join(nextArgument);
    const keep = DRAW_SPECIES_FIELDS
        .map((field, index) => `f32(controls.viewSpecies == 0u || controls.viewSpecies == ${index + 1}u)`)
        .join(nextArgument);
    const scale = DRAW_SPECIES_FIELDS
        .map((field) => wgslLiteral(((settings.speciesScale || {})[field]) ?? settings.maxConcentration));
    // language=WGSL
    return `
                    ${broken.length ? drawBrokenGuard(...broken) : ''}
                    let raw = vec4f(${read});
                    let keep = vec4f(${keep});
                    let scale = vec4f(${scale.join(', ')});
                    let shown = max(raw, vec4f(0.0)) * keep / scale;
                    color = drawSpeciesColor(shown);
                    if (controls.accessible != 0u) {
                        color = vec4f(drawSpeciesHatched(id, color.rgb, shown), 1.0);
                    }`;
}

// The material arm: a profile case reads its shape at the cell's center on the
// level shown, so a boundary is the staircase that level reads; a painted case
// is drawPaintedArm. With nothing fixed in space the arm is white, and the
// view is never offered.
function drawMaterialArm(shader) {
    const materials = drawMaterials(shader.system);
    // language=WGSL
    if (!materials) return `
                    color = vec4f(1.0, 1.0, 1.0, 1.0);`;
    if (materials.painted) return drawPaintedArm(materials, shader.settings);
    // The first material is the default; drawMaterials checked that every
    // value the shape takes is one of them.
    const choices = materials.entries.map(({ factor, color, hatch, label }, k) => {
        const set = `color = vec4f(${wgslColor(color)}, 1.0); direction = DRAW_HATCH_${hatch.toUpperCase()};`;
        // language=WGSL
        return k === 0 ? `
                    ${set}   // ${label}` : `
                    if (abs(shape - ${wgslLiteral(factor)}) <= ${wgslLiteral(1e-3 * Math.max(1, factor))}) { ${set} }   // ${label}`;
    }).join('');
    // language=WGSL
    return `
                    let center = (vec2f(cell) - vec2f(0.5)) * grid.spacing[level];
                    var shape = 0.0;
                    { let position = center; shape = ${materials.shape.wgsl}; }
                    var direction = DRAW_HATCH_NONE;${choices}
                    hatch = vec2f(f32(direction), 1.0);`;
}

// A painted case: what is at the cell's center, the catalyst array there or
// the mean of its four faces' porous drag (the momentum rows read the faces),
// darker with strength on a log scale from x1 to the strongest. Where layers
// overlap the cell takes the mean of their colors. A solid cell never reaches
// the arm: the kernel draws every solid cell the same before choosing a view.
function drawPaintedArm(materials, settings) {
    const [bare, ...painted] = materials.entries;
    const strongest = wgslLiteral(settings.paintedStrongest);
    // Each layer present here and shown (controls.viewMaterial is 0 for every
    // one, k for the k-th alone), and its color at its strength.
    const layers = painted.map(({ paint, color, dark, label }, k) => `
                    let shown${k} = select(0.0, 1.0, ${paint} > 0.0   // ${label}
                        && (controls.viewMaterial == 0u || controls.viewMaterial == ${k + 1}u));
                    mixed = mixed + shown${k} * mix(${wgslColor(color)}, ${wgslColor(dark)},
                        clamp(log(max(${paint}, 1.0)) / log(${strongest}), 0.0, 1.0));
                    present = present + shown${k};`).join('');
    // Where layers overlap their hatches are woven, each at its share of the
    // depth, as the species view weaves a mixture.
    const woven = painted.map(({ hatch }, k) => `
                        woven = drawHatch(id, woven, DRAW_HATCH_${hatch.toUpperCase()}, shown${k} / present);`).join('');
    // language=WGSL
    return `
                    let catalyst = grid.paintCatalystCenter[p];
                    let porous = 0.25 * (grid.paintPorousXFace[indexXFace(level, cell.x, cell.y)]
                        + grid.paintPorousXFace[indexXFace(level, cell.x + 1u, cell.y)]
                        + grid.paintPorousYFace[indexYFace(level, cell.x, cell.y)]
                        + grid.paintPorousYFace[indexYFace(level, cell.x, cell.y + 1u)]);
                    var mixed = vec3f(0.0);
                    var present = 0.0;${layers}
                    color = vec4f(select(${wgslColor(bare.color)}, mixed / max(present, 1.0), present > 0.0), 1.0);   // ${bare.label} where no layer is shown
                    if (controls.accessible != 0u && present > 0.0) {
                        var woven = color.rgb;${woven}
                        color = vec4f(woven, 1.0);
                    }`;
}

// The center accessor

// The bilinear sampler reads one of several center arrays chosen at run time,
// and WGSL has no pointer into a struct member, so one accessor holds a switch.
function makeDrawAccessorCode(centerFields) {
    const cases = centerFields
        .map((name, index) => `                case ${index}u: { return centerState.${name}[p]; }`)
        .join('\n');
    const constants = centerFields
        .map((name, index) => `        const ${drawBaseName(name)} : u32 = ${index}u;`)
        .join('\n');
    // language=WGSL
    return `
${constants}

        fn drawCenterValue(base : u32, column : u32, row : u32) -> f32 {
            let p = indexCenter(controls.viewLevel, column, row);
            switch base {
${cases}
                default: { return 0.0; }
            }
        }
    `;
}
