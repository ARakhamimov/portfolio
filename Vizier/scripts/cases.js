// cases.js, by Allen Rakhamimov.
// What a case declares, the presets the declarations expand into, what a
// viewer's sliders move, and a case's geometry and ports.
//
// The cases themselves are files in scripts/cases/, one per case, each a
// declaration in the groups caseDefaults lists; the equations a declaration
// becomes are physics.js. A first read takes caseDefaults, then one case file,
// then physicsSystem.

'use strict';

// What a case declares

// Every key a case may write, in its group, with the value a case that does
// not write it gets. A key that has no sensible default is declared undefined
// with the reason, so that this list is complete: a key missing here fails when
// the presets are read (caseCheckKeys), not as a NaN in a buffer.
function caseDefaults() {
    return {
        view: 'species',                        // the view the case opens on

        // Which equations run. physicsSystem holds the list of physics values and
        // refuses any other.
        system: {
            physics: 'flow',
            porous: undefined,                  // 'brinkman' or 'darcy' for a packed bed
            kinetics: 'massAction',             // or 'michaelisMenten', 'monod'
            transportsSpecies: true,            // false for a flow driven by heat alone
            speciesBOrder: 2,                   // Gray-Scott: U + 2V -> 3V
            buoyantField: undefined,            // { field, reference, sign } the force follows
            magneticFieldAlong: undefined,      // 'x' or 'y', for physics 'mhd'
            electricFieldSign: '+',             // the applied electric field's sign
            electricFieldRegion: undefined,     // where it is applied; everywhere if unset
        },

        // How the solver runs it. A rendered frame is not a time step: a case
        // that needs a smaller step takes several a frame.
        solver: {
            cells: 256,                         // the finest mesh's interior cells
            coarsestCells: 32,                  // where the multigrid hierarchy stops
            cyclesPerFrame: 3,
            timeStep: CASE_TIME_STEP,
            stepsPerFrame: 1,
            // 'spacingSquared' for a case whose step is held near h^2: the step
            // is declared at the case's own mesh and moves with the square of
            // the spacing when the resolution is changed (appActivePreset).
            timeStepScaling: undefined,
            constraintStep: 0.5,                // c in the Schur step
        },

        // Applied in this order (caseGeometry): edges, a solid fill, solid boxes,
        // boxes carved back to fluid, solid circles, then the sandbox's shapes.
        geometry: {
            edges: { left: INLET, right: OUTLET, top: WALL, bottom: WALL },
            fillInterior: false,
            solidBoxes: [],                     // [x0, y0, x1, y1] each
            carvedBoxes: [],
            solidCircles: [],                   // { x, y, radius } each
            shapes: [],
            // Stretches of an edge typed apart from it. Declaring a list, even an
            // empty one, feeds every inlet from its ports; see casePortSlotValues.
            ports: undefined,
        },

        // What every INLET location holds. A velocity may be a profile, and an
        // unset one holds speed uniformly along x and zero along y.
        inlet: {
            speed: 1,
            velocityX: undefined,
            velocityY: undefined,
            temperature: 20,
            species: { speciesA: profileSplit(0, 1), speciesB: profileSplit(1, 0), speciesC: 0 },
            flux: undefined,                    // a field entering normal to the edge
        },

        // What every WALL location holds. Unset, a wall is insulated and
        // impermeable.
        wall: {
            temperature: undefined,
            species: undefined,
        },

        // What the interior starts at. The temperature defaults to the feed's;
        // patches are { field, value, at } and paint in order.
        initial: {
            temperature: undefined,
            patches: [],
            packets: [],                        // { x, y, width, kx, ky } each, summed: a wave function's start
        },

        // The physical constants, each with its default from
        // COEFFICIENT_CONSTANTS. A zero leaves the term out and its slider off
        // the page, so a case that forgets a constant it needs fails loudly.
        coefficients: Object.fromEntries(COEFFICIENT_CONSTANTS
            .filter((constant) => !constant.path).map((constant) => [constant.name, constant.default])),

        feeds: [],                              // region sources, { field, rate, target, at, wgsl }
        charges: [],                            // disks { x, y, radius, density }
        // Every slider the case shows, by name, as [lowest, highest]. A
        // temperature moves linearly between the two, anything else in equal
        // ratios. Listing wallTemperature, inletTemperature, heaterTemperature
        // or thermalDiffusivity also turns that literal into a slot.
        sliders: {},
        paintable: false,                       // whether a viewer may paint regions

        // Display scales, fixed by the case and never adaptive, so that a
        // decaying field is seen to decay.
        display: {
            speciesScale: {},                   // full scale per species
            potentialScale: 1,
            fluxScale: 1,
            currentScale: 1,
            fieldLineScale: 1,                  // the span of A drawn as the line count
            waveScale: 1,                       // the amplitude of a wave function drawn full
            materials: undefined,               // what the material view names
        },

        // What the panel's dimensionless numbers are built on. The velocity
        // defaults to the inlet's, or its parabolic peak; the length to the first
        // circle's diameter, or the box.
        panel: {
            velocityScale: undefined,
            lengthScale: undefined,
            temperatureDifference: undefined,   // for a Rayleigh number
            heatFluxWalls: undefined,           // { hot, cold } edges, for a Nusselt number
        },
    };
}

// The groups above. A later layer replaces a key inside a group and keeps the
// group's other keys, so a reaction that sets coefficients.reactionRate keeps
// the case's viscosity.
const CASE_GROUPS = ['system', 'solver', 'geometry', 'inlet', 'wall', 'initial',
    'coefficients', 'sliders', 'display', 'panel'];

function caseMerge(...layers) {
    const merged = {};
    for (const layer of layers) {
        for (const [key, value] of Object.entries(layer)) {
            merged[key] = CASE_GROUPS.includes(key) ? { ...merged[key], ...value } : value;
        }
    }
    return merged;
}

// Every key a case or a reaction writes is one caseDefaults declares.
const CASE_IDENTITY_KEYS = ['id', 'label', 'category', 'note', 'caseId', 'caseLabel',
    'reaction', 'reactionLabel', 'reactionNote', 'defaultReaction'];

function caseCheckKeys(preset, defaults) {
    for (const [key, value] of Object.entries(preset)) {
        if (CASE_IDENTITY_KEYS.includes(key)) continue;
        if (!(key in defaults)) throw new Error(`${preset.id}: unknown key ${key}`);
        if (!CASE_GROUPS.includes(key) || key === 'sliders') continue;
        for (const inner of Object.keys(value)) {
            if (!(inner in defaults[key])) throw new Error(`${preset.id}: unknown key ${key}.${inner}`);
        }
    }
    // A scale per species, by name; a bare number would read as no scale.
    const scale = preset.display.speciesScale;
    if (typeof scale !== 'object' || Object.values(scale).some((value) => !(value > 0))) {
        throw new Error(`${preset.id}: display.speciesScale is { speciesA: 0.5, ... }, a positive `
            + 'full-scale value per species');
    }
    return preset;
}

// Each case is a file in scripts/cases/, listed in manifest.js in the order the
// case box shows them. A file registers a function that builds its
// declaration, called when the presets are read: a declaration reads names
// another file defines, so it cannot be built while files are still loading.
const CASE_BUILDERS = [];

function caseRegister(build) {
    CASE_BUILDERS.push(build);
    casePresetList = null;
}

// A case saved from the sandbox (sandboxExportText): the sandbox's own
// declaration with the saved layout, opening on the saved reaction with the
// saved slider values. It stays in the sandbox category, so it can still be
// edited.
function caseRegisterExported(data) {
    const build = () => {
        const base = CASE_BUILDERS.filter((other) => !other.exported).map((other) => other())
            .find((declaration) => declaration.id === 'sandbox');
        if (!base) throw new Error(`${data.id}: a saved case needs the sandbox case to build on`);
        const controls = {};
        for (const [name, value] of Object.entries(data.controls || {})) {
            const [group, key] = caseControlPath(name);
            if (group === 'coefficients') controls[key] = value;
        }
        const coefficients = { ...base.coefficients, ...controls };
        return {
            ...base, id: data.id, label: data.label, category: 'sandbox', exported: true, note: data.note,
            geometry: { ...base.geometry, ...data.layout },
            coefficients,
            reactions: base.reactions.map((reaction) => (reaction.name === data.reaction
                ? { ...reaction, coefficients: { ...reaction.coefficients, ...controls } } : reaction)),
            defaultReaction: data.reaction,
        };
    };
    build.exported = true;
    CASE_BUILDERS.push(build);
    casePresetList = null;
    // A way to take it back out, for a check that registers one on a page
    // the other checks share.
    return () => {
        CASE_BUILDERS.splice(CASE_BUILDERS.indexOf(build), 1);
        casePresetList = null;
    };
}

function caseCases() {
    const cases = CASE_BUILDERS.map((build) => build());
    const seen = new Set();
    for (const { id } of cases) {
        if (seen.has(id)) throw new Error(`two case files declare the id ${id}`);
        seen.add(id);
    }
    return cases;
}

// The heading the manifest lists a case under (CASE_CATEGORIES). A saved case
// is not listed there and declares the sandbox's.
function caseCategoryOf(declaration) {
    if (declaration.category !== undefined) {
        if (!declaration.exported) {
            throw new Error(`${declaration.id}: a case's category is the heading manifest.js lists it under`);
        }
        return declaration.category;
    }
    const listed = CASE_CATEGORIES.find(({ cases }) => cases.includes(declaration.id));
    if (!listed) throw new Error(`${declaration.id} is not listed in manifest.js`);
    return listed.name;
}

// The reactions every case that feeds A and B offers: none, then the three
// rate laws at one Damkohler number. Michaelis-Menten runs at the mass action
// rate, and Monod's substrate leaves at its growth rate over its yield, which
// is the mass action rate again. `shared` is what every choice keeps that a
// special reaction beside them must not, such as a wall temperature.
function caseStandardReactions(rate, shared = {}) {
    return [
        { ...shared, name: 'none', label: 'none',
          coefficients: { reactionRate: 0 },
          reactionNote: 'No reaction. A and B are carried and spread, and nothing forms.' },
        { ...shared, name: 'massAction', label: 'mass action',
          coefficients: { reactionRate: rate },
          sliders: { reactionRate: [rate / 8, rate * 8] },
          reactionNote: 'A and B make C at a rate proportional to both.' },
        { ...shared, name: 'michaelisMenten', label: 'Michaelis-Menten',
          system: { kinetics: 'michaelisMenten' },
          coefficients: { reactionRate: rate, halfSaturation: 0.15 },
          sliders: { reactionRate: [rate / 8, rate * 8], halfSaturation: [0.01875, 1.2] },
          reactionNote: 'B is an enzyme that converts A without being used up. The rate '
              + 'levels off once A is plentiful.' },
        { ...shared, name: 'monod', label: 'Monod',
          system: { kinetics: 'monod' },
          coefficients: { reactionRate: 0.4 * rate, halfSaturation: 0.15, yieldCoefficient: 0.4 },
          sliders: { reactionRate: [0.05 * rate, 3.2 * rate], halfSaturation: [0.01875, 1.2],
              yieldCoefficient: [0.05, 3.2] },
          reactionNote: 'B is a population that feeds on A and grows. No C forms.' },
    ];
}

// Every case expanded into the presets the page runs, one per reaction. A
// pair's id is the case id and the reaction's name run together, except that
// the pair with no reaction keeps the bare case id.
//
// T0 is set here, from the case's own feed temperature, and never moves with a
// slider: moving T0 with s held fixed describes a different activation energy.
//
// Built on the first read, once every case file has loaded, and again after a
// case registers. Frozen, so that a preset is a value every reader shares.
let casePresetList = null;

function casePresets() {
    if (casePresetList === null) casePresetList = caseFreeze(caseBuildPresets());
    return casePresetList;
}

function caseFreeze(value) {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
    for (const member of Object.values(value)) caseFreeze(member);
    return Object.freeze(value);
}

function caseBuildPresets() {
    const defaults = caseDefaults();
    const presets = [];
    for (const { reactions, defaultReaction, exported, ...declared } of caseCases()) {
        // The category goes where a case file used to write it, after its label.
        const { id, label, ...rest } = declared;
        const base = { id, label, category: caseCategoryOf({ ...declared, exported }), ...rest };
        if (reactions && !reactions.some(({ name }) => name === defaultReaction)) {
            throw new Error(`${base.id}: defaultReaction ${defaultReaction} is not offered`);
        }
        const pairs = reactions
            ? reactions.map(({ name, label, ...constants }) => ({
                ...constants,
                id: name === 'none' ? base.id : base.id + name[0].toUpperCase() + name.slice(1),
                label: name === 'none' ? base.label : `${base.label}, ${label}`,
                reaction: name,
                reactionLabel: label,
                defaultReaction: name === defaultReaction,
            }))
            : [{ reaction: null, reactionLabel: null, defaultReaction: true }];
        for (const pair of pairs) {
            const preset = caseMerge(defaults, base, pair,
                { caseId: base.id, caseLabel: base.label });
            if (preset.coefficients.referenceTemperature === undefined) {
                preset.coefficients.referenceTemperature = preset.inlet.temperature;
            }
            presets.push(caseCheckSliders(caseCheckHierarchy(caseCheckKeys(preset, defaults))));
        }
    }
    return presets;
}

function casePreset(id) {
    const found = casePresets().find((preset) => preset.id === id);
    if (!found) throw new Error(`no preset named ${id}`);
    return found;
}

// A finest mesh or a coarsest level that is not a mesh size, or a coarsest level
// not below the finest, would leave the hierarchy nothing to correct with.
function caseCheckHierarchy(preset) {
    if (!MESH_SIZES.includes(preset.solver.cells) || !MESH_SIZES.includes(preset.solver.coarsestCells)
        || !(preset.solver.cells > preset.solver.coarsestCells)) {
        throw new Error(`${preset.id}: cells ${preset.solver.cells} and coarsestCells `
            + `${preset.solver.coarsestCells} must both be mesh sizes, the coarsest below the finest`);
    }
    return preset;
}

// What a viewer's sliders move

// Where a slider's value lives, by the slider's name: the two boundary
// temperatures in their boundary's group (a constant's path), and every other
// in the coefficients.
function caseControlPath(name) {
    const constant = COEFFICIENT_CONSTANTS.find((entry) => entry.name === name);
    return (constant && constant.path) || ['coefficients', name];
}

function caseControlValue(preset, name) {
    const [group, key] = caseControlPath(name);
    return preset[group][key];
}

// Every declared constant of a case, wherever it lives, by name: what the
// slots are built from (coefficientSlotValues).
function caseConstants(preset) {
    const constants = { ...preset.coefficients };
    for (const constant of COEFFICIENT_CONSTANTS) {
        if (constant.path) constants[constant.name] = caseControlValue(preset, constant.name);
    }
    return constants;
}

// A copy of the preset with each named value set. The preset is never written.
function caseWithControls(preset, values) {
    const result = { ...preset };
    for (const [name, value] of Object.entries(values)) {
        const [group, key] = caseControlPath(name);
        result[group] = { ...result[group], [key]: value };
    }
    return result;
}

// The temperatures move linearly; everything else moves in equal ratios.
function caseSliderMovesLinearly(name) {
    return coefficientConstant(name).moves === 'linearly';
}

function caseHasSlider(preset, name) {
    return name in preset.sliders;
}

// A literal with a slider is read from its slot, so the slider moves it with a
// buffer write; with none, it is a literal in the shader.
function caseSliderValue(preset, name) {
    return caseHasSlider(preset, name) ? coefficientSlot(name) : caseControlValue(preset, name);
}

// Each range holds the value the case starts at, and a heated section targets
// the heater's slot exactly when the heater temperature has a slider.
function caseCheckSliders(preset) {
    for (const [name, range] of Object.entries(preset.sliders)) {
        const value = caseControlValue(preset, name);
        const [low, high] = Array.isArray(range) ? range : [];
        if (!Number.isFinite(low) || !Number.isFinite(high) || !(low < high)) {
            throw new Error(`${preset.id}: sliders.${name} is [lowest, highest], lowest first`);
        }
        if (!caseSliderMovesLinearly(name) && !(low > 0)) {
            throw new Error(`${preset.id}: sliders.${name} moves in ratios, so its lowest is above zero`);
        }
        if (!(value >= low && value <= high)) {
            throw new Error(`${preset.id}: sliders.${name} runs ${low} to ${high} but the case `
                + `starts at ${value}`);
        }
    }
    const heaterSlot = preset.feeds.some((feed) => feed.field === 'temperature'
        && coefficientIsSlot(feed.target) && feed.target.coefficientSlot === 'heaterTemperature');
    if (heaterSlot !== caseHasSlider(preset, 'heaterTemperature')) {
        throw new Error(`${preset.id}: a heated section targets the heaterTemperature slot if and `
            + 'only if the heater temperature has a slider');
    }
    return preset;
}

// Shared numbers

// theta above one half damps the ringing Crank-Nicolson leaves at a sharp
// front.
const CASE_THETA = 0.55;
const CASE_TIME_STEP = 1 / 60;

// Geometry and ports

// Also how the sandbox applies an edit: this runs again on the classified
// plate, and marks it afresh from the whole layout.
function caseGeometry(plate, preset) {
    const geometry = preset.geometry;
    const solids = [];
    const paints = [];
    if (geometry.fillInterior) solids.push({ kind: 'fill', type: WALL });
    for (const r of geometry.solidBoxes || []) solids.push({ kind: 'rect', x0: r[0], y0: r[1], x1: r[2], y1: r[3], type: WALL });
    for (const r of geometry.carvedBoxes || []) solids.push({ kind: 'rect', x0: r[0], y0: r[1], x1: r[2], y1: r[3], type: FLUID });
    for (const shape of geometry.solidCircles || []) {
        solids.push({ kind: 'circle', centerX: shape.x, centerY: shape.y, radius: shape.radius, type: WALL });
    }
    for (const shape of geometry.shapes || []) {
        const marked = caseShapeGeometry(shape);
        solids.push(...marked.solids);
        paints.push(...marked.paints);
    }
    addGeometry(plate, { edges: geometry.edges, ports: casePortRanges(geometry.ports || []), solids, paints });
}

// A shape either changes the geometry, solid or carved, or paints a material
// over whatever is there; the plate holds the two apart.
const CASE_PAINTS = ['catalyst', 'porous', 'bare'];

function caseShapeGeometry(shape) {
    // A catalyst pellet: a solid core in an active shell. The paint covers the
    // whole disk and the core is solid, so what is left of the paint is the ring.
    if (shape.kind === 'pellet') {
        return {
            paints: [{ shape: { kind: 'circle', centerX: shape.x, centerY: shape.y, radius: shape.radius },
                material: 'catalyst', strength: shape.strength }],
            solids: [{ kind: 'circle', centerX: shape.x, centerY: shape.y, radius: shape.radius - shape.shell,
                type: WALL }],
        };
    }
    if (shape.paint !== undefined) {
        if (!CASE_PAINTS.includes(shape.paint)) {
            throw new Error(`a shape paints catalyst, porous or bare, not ${shape.paint}`);
        }
        return { paints: [{ shape: casePlateShape(shape), material: shape.paint, strength: shape.strength }],
            solids: [] };
    }
    return { paints: [], solids: [{ ...casePlateShape(shape), type: shape.solid === false ? FLUID : WALL }] };
}

// A layout shape in the form the plate holds it.
function casePlateShape(shape) {
    switch (shape.kind) {
        case 'circle':  return { kind: 'circle', centerX: shape.x, centerY: shape.y, radius: shape.radius };
        case 'box':     return { kind: 'rect', x0: Math.min(shape.x0, shape.x1), y0: Math.min(shape.y0, shape.y1),
            x1: Math.max(shape.x0, shape.x1), y1: Math.max(shape.y0, shape.y1) };
        case 'capsule': return { kind: 'capsule', x0: shape.x0, y0: shape.y0, x1: shape.x1, y1: shape.y1,
            radius: shape.radius };
        case 'stroke':  return { kind: 'stroke', points: shape.points, radius: shape.radius };
    }
    throw new Error(`a shape is a circle, a box, a capsule or a stroke, not ${shape.kind}`);
}

// A port is written against its edge and stored along the perimeter (boundary.js,
// boundaryPerimeterOf), where one number places it.
const CASE_PORT_EDGES = ['left', 'top', 'right', 'bottom'];

function casePortRanges(ports) {
    return ports.map((port) => {
        const edge = CASE_PORT_EDGES.indexOf(port.edge);
        if (edge < 0) throw new Error(`a port's edge is one of ${CASE_PORT_EDGES.join(', ')}`);
        return { start: edge + port.from, end: edge + port.to, type: port.type };
    });
}

// Every port slot, so the Coefficients buffer holds no unaccounted number. An
// unused port ends below where any boundary point lies.
function casePortSlotValues(ports) {
    const values = {};
    for (let k = 0; k < boundaryPortCount(); k++) {
        const port = ports[k];
        const range = port ? casePortRanges([port])[0] : { start: -2, end: -2 };
        const feeds = port && port.type === INLET;
        values[`portStart${k}`] = range.start;
        values[`portEnd${k}`] = range.end;
        values[`portSpeed${k}`] = feeds ? port.speed : 0;
        values[`portFeedA${k}`] = feeds ? port.feedA : 0;
        values[`portFeedB${k}`] = feeds ? port.feedB : 0;
    }
    return values;
}

// The speed the panel takes a ported case to be fed at: its fastest inlet.
function caseFastestPort(ports) {
    return Math.max(0, ...ports.filter((port) => port.type === INLET).map((port) => port.speed || 0));
}
