// grid.js, by Allen Rakhamimov.
// Staggered storage in both languages: where every point of every level lives.
//
// The Plate holds the array shapes, the per-level offsets, the boundary
// classification and the buffers the GPU reads. The last division prints the
// WGSL structs and index functions from the same tables, so the shader and the
// host cannot disagree about where a point is. A first read needs the
// locations, the point offsets and the Plate's index helpers, and can skip
// everything from the GPU buffers on.

'use strict';

// Locations

const CENTER = 0;
const XFACE  = 1;
const YFACE  = 2;

// Each location's names, by its number: in words, as the kind of point its
// offsets are keyed by (GRID_POINT_OFFSETS), and as the suffix its arrays and
// WGSL functions carry (indexXFace, widthCenter, isInteriorYFace).
const LOCATION_NAMES = [
    { words: 'center', kind: 'center', suffix: 'Center' },
    { words: 'x-face', kind: 'xFace',  suffix: 'XFace' },
    { words: 'y-face', kind: 'yFace',  suffix: 'YFace' },
];

// The WGSL functions every emitter calls for a point at a location.
function indexFunctionAt(location) { return `index${LOCATION_NAMES[location].suffix}`; }
function positionFunctionAt(location) { return `position${LOCATION_NAMES[location].suffix}`; }

// Resolutions, array shapes and point positions

// Interior cell counts per level, finest first. The arrays add a ghost margin,
// so their widths (258, 130, 66) are not powers of two.
const MESH_SIZES = [1024, 512, 256, 128, 64, 32, 16];
const DEFAULT_MESH_INDEX = 2;

function widthOf(location, interior) {
    switch (location) {
        case CENTER: return interior + 2;
        case XFACE:  return interior + 3;
        case YFACE:  return interior + 2;
    }
    throw new Error(`widthOf: unknown location ${location}`);
}

function heightOf(location, interior) {
    switch (location) {
        case CENTER: return interior + 2;
        case XFACE:  return interior + 2;
        case YFACE:  return interior + 3;
    }
    throw new Error(`heightOf: unknown location ${location}`);
}

function countOf(location, interior) {
    return widthOf(location, interior) * heightOf(location, interior);
}

// Where each kind of point sits: the point with index k along an axis is at
// (k + offset) * spacing, the interior being the unit square. A face with
// index k is the minus face of cell k. A corner is where vorticity is
// evaluated, never a place an array is stored. Every position in both
// languages is read from this table.
const GRID_POINT_OFFSETS = {
    center: { x: -0.5, y: -0.5 },
    xFace:  { x: -1.0, y: -0.5 },
    yFace:  { x: -0.5, y: -1.0 },
    corner: { x: -1.0, y: -1.0 },
};

function gridKindOf(kindOrLocation) {
    const kind = typeof kindOrLocation === 'number' ? LOCATION_NAMES[kindOrLocation].kind : kindOrLocation;
    if (!GRID_POINT_OFFSETS[kind]) throw new Error(`grid: no kind of point named ${kindOrLocation}`);
    return kind;
}

// Where a kind of point (or a storage location, by its number) sits before its
// index along an axis, in cells.
function gridOffsetAlong(kindOrLocation, axis) {
    if (axis !== 'x' && axis !== 'y') throw new Error(`gridOffsetAlong: no axis named ${axis}`);
    return GRID_POINT_OFFSETS[gridKindOf(kindOrLocation)][axis];
}

// A flat index: the level's offset into the array, plus the column, plus that
// many rows of the level's width. Printed as the Plate's indexCenter,
// indexXFace and indexYFace and as the shader's functions of the same names.
function gridIndexExpression(offset, width) {
    return `${offset} + column + row * ${width}`;
}

// The one fencepost: N cells are spanned by N + 1 faces, so a point that sits a
// whole number of cells from its index has one more interior point along that
// axis.
const GRID_EXTRA_ALONG = LOCATION_NAMES.map(({ kind }) => ({
    x: Number.isInteger(GRID_POINT_OFFSETS[kind].x) ? 1 : 0,
    y: Number.isInteger(GRID_POINT_OFFSETS[kind].y) ? 1 : 0,
}));

// Physical position of a point of a kind (or a storage location).
function positionOf(kindOrLocation, column, row, spacing) {
    return {
        x: (column + gridOffsetAlong(kindOrLocation, 'x')) * spacing,
        y: (row + gridOffsetAlong(kindOrLocation, 'y')) * spacing,
    };
}

// The buffers that hold the fields

// WebGPU's default per-binding limit. The center arrays are split into state
// and workspace to stay under it at 1024.
const MAX_STORAGE_BINDING_BYTES = 134217728;

const BUFFER_GROUPS = [
    { name: 'centerState',     location: CENTER, roles: ['value', 'history'] },
    { name: 'centerWorkspace', location: CENTER, roles: ['residual', 'rightHandSide', 'restricted'] },
    { name: 'xFace',           location: XFACE,  roles: ['value', 'history', 'residual', 'rightHandSide', 'restricted'] },
    { name: 'yFace',           location: YFACE,  roles: ['value', 'history', 'residual', 'rightHandSide', 'restricted'] },
];

// Which buffer an array lives in, from its location and its role. Every WGSL
// array reference comes through here: a name in the wrong buffer would read
// another field silently.
function bufferGroupFor(location, role) {
    const group = BUFFER_GROUPS.find((g) => g.location === location && g.roles.includes(role));
    if (!group) throw new Error(`no buffer group holds a ${role} array at location ${location}`);
    return group.name;
}

// The controls buffer
//
// One row per member, in buffer order: its WGSL type, how many it holds (one,
// one per level, one per solved field, or a fixed count), the value a new
// plate starts with (zero unless given), and whether a rebuild for another
// case or resolution keeps the viewer's value. The Plate's arrays, the
// Controls struct and the page's carry-over across a rebuild all read it.
// Display switches live here, so toggling one between two pictures is a
// buffer write and not a rebuild.
const CONTROLS_MEMBERS = [
    // The level a kernel runs at, set by a one-thread kernel (setLevel), and
    // what the picture shows. The page keeps the view across a rebuild itself,
    // clamped to what the new case offers.
    { name: 'computeLevel',    type: 'u32' },
    { name: 'viewLevel',       type: 'u32' },
    { name: 'viewMode',        type: 'u32' },
    { name: 'viewField',       type: 'u32' },
    { name: 'accessible',      type: 'u32', kept: true },
    { name: 'bilinear',        type: 'u32', start: 1, kept: true },
    { name: 'arrows',          type: 'u32', kept: true },
    // 0 draws every species and k isolates the k-th of DRAW_SPECIES_FIELDS,
    // by zeroing the others, so a species keeps its hue when alone.
    { name: 'viewSpecies',     type: 'u32' },
    { name: 'viewMaterial',    type: 'u32' },
    { name: 'streamlines',     type: 'u32', kept: true },
    { name: 'equipotentials',  type: 'u32', start: 1, kept: true },
    // Canvas pixels per CSS pixel. Hatch pitch is set in screen pixels; in
    // canvas pixels it would shrink as the layout narrows until the browser's
    // downscaling filtered the hatch away.
    { name: 'hatchScale',      type: 'f32', start: 1, kept: true },
    // The hatch's period in screen pixels, and how far it swings toward white
    // and toward black. The swing is symmetric, so the mean color is the plain
    // one and the accessible view is not a dimmer view. Viewers' controls, as
    // are the arrow spacing and the contour count, since what is legible
    // depends on the viewer and the display.
    { name: 'hatchPitch',      type: 'f32', start: 14, kept: true },
    { name: 'hatchDepth',      type: 'f32', start: 0.45, kept: true },
    { name: 'arrowPitch',      type: 'f32', start: 34, kept: true },
    { name: 'contourCount',    type: 'f32', start: 16, kept: true },
    // The fraction of the peak speed below which the velocity view draws
    // neutral; zero turns it off.
    { name: 'velocityCutoff',  type: 'f32', kept: true },
    // Written by a kernel, so the largest speed is never read back to the
    // host each frame.
    { name: 'velocityMax',     type: 'f32', count: 'levels' },
    { name: 'velocityMaxBits', type: 'atomic<u32>', count: 'levels' },
    // The largest magnitude each solved field holds on the finest level, in
    // the system's equation order, as bits under an atomic max: a NaN's bits
    // beat every finite value's. The divergence watchdog reads it.
    { name: 'fieldHealthBits', type: 'atomic<u32>', count: 'fields' },
    // The largest |psi| on the view level, as bits under an atomic max; it
    // sets the streamline spacing.
    { name: 'streamMaxBits',   type: 'atomic<u32>' },
    // The mean temperature gradient into the fluid at a case's hot wall and
    // out of it at the cold one, on the finest level, for the Nusselt number.
    { name: 'wallHeatFlux',    type: 'f32', count: 2 },
];

function gridControlsLength(member, levels) {
    if (member.count === 'levels') return levels;
    if (member.count === 'fields') return FIELD_HEALTH_SLOTS;
    return member.count || 1;
}

function gridControlsType(member, levels) {
    return member.count ? `array<${member.type}, ${gridControlsLength(member, levels)}>` : member.type;
}

// The Plate: array sizes, offsets and indexing

class Plate {

    // finestLevelIndex indexes MESH_SIZES (0 is 1024). coarsestInterior stops the
    // hierarchy early: a case stops where its solver group says (32 unless it
    // declares otherwise), and the default 16 serves checks on small meshes.
    // `fields` names the fields the page allocates for a running system
    // (simulationFields in fields.js); a check leaves it out and gets arrays
    // for every field.
    constructor(finestLevelIndex = DEFAULT_MESH_INDEX, coarsestInterior = MESH_SIZES[MESH_SIZES.length - 1],
        fields = undefined) {
        this.fields = fields;
        this.finestLevelIndex = Math.max(0, Math.min(Math.round(finestLevelIndex), MESH_SIZES.length - 1));

        const active = MESH_SIZES.slice(this.finestLevelIndex)
            .filter((interiorCells, index) => index === 0 || interiorCells >= coarsestInterior);

        this.interior   = new Uint32Array(active);
        this.numLevels  = this.interior.length;
        this.coarsestLevel = this.numLevels - 1;
        this.spacing    = new Float32Array(active.map((interiorCells) => 1 / interiorCells));

        // Stored per location and level, so no kernel has to remember whether
        // a location adds 2 or 3 to the interior.
        this.widthCenter  = new Uint32Array(active.map((interiorCells) => widthOf(CENTER, interiorCells)));
        this.heightCenter = new Uint32Array(active.map((interiorCells) => heightOf(CENTER, interiorCells)));
        this.widthXFace   = new Uint32Array(active.map((interiorCells) => widthOf(XFACE, interiorCells)));
        this.heightXFace  = new Uint32Array(active.map((interiorCells) => heightOf(XFACE, interiorCells)));
        this.widthYFace   = new Uint32Array(active.map((interiorCells) => widthOf(YFACE, interiorCells)));
        this.heightYFace  = new Uint32Array(active.map((interiorCells) => heightOf(YFACE, interiorCells)));

        // Where each level starts in a location's array: numLevels + 1 entries,
        // the last being the total.
        this.offsetCenter = new Uint32Array(this.buildOffsets(CENTER));
        this.offsetXFace  = new Uint32Array(this.buildOffsets(XFACE));
        this.offsetYFace  = new Uint32Array(this.buildOffsets(YFACE));

        this.totalCenter = this.offsetCenter[this.numLevels];
        this.totalXFace  = this.offsetXFace[this.numLevels];
        this.totalYFace  = this.offsetYFace[this.numLevels];

        // A boundary type per point, one array per location. A face's type is
        // stored, never derived when read, so a wrong one fails visibly and not
        // as a half-cell offset.
        this.typeCenter = new Int32Array(this.totalCenter);
        this.typeXFace  = new Int32Array(this.totalXFace);
        this.typeYFace  = new Int32Array(this.totalYFace);

        // What a viewer has painted, at each location a painted coefficient is
        // read at. Zero is unpainted.
        this.paintCatalystCenter = new Float32Array(this.totalCenter);
        this.paintPorousXFace    = new Float32Array(this.totalXFace);
        this.paintPorousYFace    = new Float32Array(this.totalYFace);

        // Walled on every side until a case marks its geometry (addGeometry).
        this.allocateFields();
        addGeometry(this, {});
        this.buildExports();
    }

    buildOffsets(location) {
        const offsets = [0];
        let sum = 0;
        for (let level = 0; level < this.numLevels; level++) {
            sum += countOf(location, this.interior[level]);
            offsets.push(sum);
        }
        return offsets;
    }

    offsetOf(location, level) {
        switch (location) {
            case CENTER: return this.offsetCenter[level];
            case XFACE:  return this.offsetXFace[level];
            case YFACE:  return this.offsetYFace[level];
        }
        throw new Error(`offsetOf: unknown location ${location}`);
    }

    widthAt(location, level) {
        switch (location) {
            case CENTER: return this.widthCenter[level];
            case XFACE:  return this.widthXFace[level];
            case YFACE:  return this.widthYFace[level];
        }
        throw new Error(`widthAt: unknown location ${location}`);
    }

    heightAt(location, level) {
        switch (location) {
            case CENTER: return this.heightCenter[level];
            case XFACE:  return this.heightXFace[level];
            case YFACE:  return this.heightYFace[level];
        }
        throw new Error(`heightAt: unknown location ${location}`);
    }

    // indexCenter, indexXFace and indexYFace are printed after the class, from
    // gridIndexExpression.
    indexOf(location, level, column, row) {
        switch (location) {
            case CENTER: return this.indexCenter(level, column, row);
            case XFACE:  return this.indexXFace(level, column, row);
            case YFACE:  return this.indexYFace(level, column, row);
        }
        throw new Error(`indexOf: unknown location ${location}`);
    }

    // The last interior index: N along a center axis or a face's tangential
    // axis, N + 1 along a face's own normal.
    interiorLastX(location, level) {
        return this.interior[level] + GRID_EXTRA_ALONG[location].x;
    }

    interiorLastY(location, level) {
        return this.interior[level] + GRID_EXTRA_ALONG[location].y;
    }

    typeArrayOf(location) {
        switch (location) {
            case CENTER: return this.typeCenter;
            case XFACE:  return this.typeXFace;
            case YFACE:  return this.typeYFace;
        }
        throw new Error(`typeArrayOf: unknown location ${location}`);
    }

    allocateFields() {
        this.fieldArrays = expandFieldSpec(FIELD_SPEC, this.fields);
        for (const entry of this.fieldArrays) {
            this[entry.name] = new Float32Array(this.offsetOf(entry.location, this.numLevels));
        }
        // A group the case puts nothing in, the faces of a case with no
        // vector, still has to be bound, and WGSL refuses an empty struct.
        for (const group of BUFFER_GROUPS) {
            if (this.arraysInGroup(group).length) continue;
            const name = `${group.name}Unused`;
            this.fieldArrays.push({ name, location: group.location, role: group.roles[0], field: null });
            this[name] = new Float32Array(4);
        }
    }

    arraysInGroup(group) {
        return this.fieldArrays.filter(
            (a) => a.location === group.location && group.roles.includes(a.role)
        );
    }

    // GPU buffers: a list of typed arrays per buffer and a running byte
    // offset table. Every member is a 4-byte scalar, so nothing is padded.

    buildExports() {
        this.numLevelsArray    = new Uint32Array([this.numLevels]);
        this.finestLevelArray  = new Uint32Array([0]);
        // The controls buffer, one array per member of CONTROLS_MEMBERS.
        for (const member of CONTROLS_MEMBERS) {
            const length = gridControlsLength(member, this.numLevels);
            this[member.name] = (member.type === 'f32' ? new Float32Array(length) : new Uint32Array(length))
                .fill(member.start || 0);
        }

        this.exportLayout = [
            this.numLevelsArray,
            this.finestLevelArray,
            this.interior,
            this.spacing,
            this.widthCenter,
            this.heightCenter,
            this.widthXFace,
            this.heightXFace,
            this.widthYFace,
            this.heightYFace,
            this.offsetCenter,
            this.offsetXFace,
            this.offsetYFace,
            this.typeCenter,
            this.typeXFace,
            this.typeYFace,
            this.paintCatalystCenter,
            this.paintPorousXFace,
            this.paintPorousYFace,
        ];

        this.exportGroups = {};
        this.exportByteOffsets = {};

        for (const group of BUFFER_GROUPS) {
            const arrays = this.arraysInGroup(group).map((a) => this[a.name]);
            this.exportGroups[group.name] = arrays;
            this.exportByteOffsets[group.name] = byteOffsetsFor(arrays);
        }

        this.exportByteOffsetsLayout = byteOffsetsFor(this.exportLayout);

        // Looked up by name everywhere, in the order the Controls struct is
        // printed in.
        this.controlsSlotNames = CONTROLS_MEMBERS.map((member) => member.name);
        this.exportControls = this.controlsSlotNames.map((name) => this[name]);
        this.exportByteOffsetsControls = byteOffsetsFor(this.exportControls);

        // One f32 per coefficient slot, so the Coefficients struct is
        // generated from the same list.
        this.coefficientSlotNames = COEFFICIENT_SLOTS.slice();
        for (const name of this.coefficientSlotNames) this[name] = new Float32Array([0]);
        this.exportCoefficients = this.coefficientSlotNames.map((name) => this[name]);
        this.exportByteOffsetsCoefficients = byteOffsetsFor(this.exportCoefficients);
    }

    controlsByteOffset(name) {
        const slot = this.controlsSlotNames.indexOf(name);
        if (slot < 0) throw new Error(`controlsByteOffset: no controls member named ${name}`);
        return this.exportByteOffsetsControls[slot];
    }

    coefficientsByteOffset(name) {
        const slot = this.coefficientSlotNames.indexOf(name);
        if (slot < 0) throw new Error(`coefficientsByteOffset: no coefficient slot named ${name}`);
        return this.exportByteOffsetsCoefficients[slot];
    }

    coefficientValue(name) {
        const array = this[name];
        if (!array || !this.coefficientSlotNames.includes(name)) {
            throw new Error(`coefficientValue: no coefficient slot named ${name}`);
        }
        return array[0];
    }

    // Every slot at once, and every one must be supplied, so none keeps the
    // number a previous case wrote.
    setCoefficients(values) {
        for (const name of Object.keys(values)) {
            if (!this.coefficientSlotNames.includes(name)) {
                throw new Error(`setCoefficients: no coefficient slot named ${name}`);
            }
        }
        for (const name of this.coefficientSlotNames) {
            const value = values[name];
            if (!Number.isFinite(value)) {
                throw new Error(`setCoefficients: slot ${name} was given ${value}; every slot has `
                    + 'to be supplied, or the shader reads the previous case\'s number');
            }
            this[name][0] = value;
        }
    }

    bufferBytes(groupName) {
        const offsets = this.exportByteOffsets[groupName];
        return offsets[offsets.length - 1];
    }

    // A row per level, for reports.
    layoutTable() {
        const rows = [];
        for (let level = 0; level < this.numLevels; level++) {
            const interiorCells = this.interior[level];
            rows.push({
                level,
                interior: interiorCells,
                spacing: this.spacing[level],
                center: `${this.widthCenter[level]} x ${this.heightCenter[level]}`,
                xFace:  `${this.widthXFace[level]} x ${this.heightXFace[level]}`,
                yFace:  `${this.widthYFace[level]} x ${this.heightYFace[level]}`,
                interiorFaces: interiorCells + 1,
                offsetCenter: this.offsetCenter[level],
                offsetXFace:  this.offsetXFace[level],
                offsetYFace:  this.offsetYFace[level],
            });
        }
        return rows;
    }
}

for (const { suffix: name } of LOCATION_NAMES) {
    Plate.prototype[`index${name}`] = new Function('level', 'column', 'row',
        `return ${gridIndexExpression(`this.offset${name}[level]`, `this.width${name}[level]`)};`);
}

// Byte offsets

function byteOffsetsFor(arrays) {
    const offsets = [0];
    let running = 0;
    for (const array of arrays) {
        running += 4 * array.length;
        offsets.push(running);
    }
    return offsets;
}

// The WGSL half: structs, bindings and index functions

// Prepended to every shader module, and printed from the same lists the Plate
// allocates from: the buffer groups, CONTROLS_MEMBERS and the coefficient
// slots.

function makeStructCode(plate) {
    const levels = plate.numLevels;
    const offsetEntries = plate.numLevels + 1;

    const groupStruct = (group) => {
        const members = plate.arraysInGroup(group)
            .map((a) => `            ${a.name}: array<f32, ${plate[a.name].length}>,`)
            .join('\n');
        return `        struct ${gridCapitalized(group.name)} {\n${members}\n        };`;
    };

    // language=WGSL
    return `
        struct Layout {
            numLevels: u32,
            finestLevel: u32,
            interior: array<u32, ${levels}>,
            spacing: array<f32, ${levels}>,
            widthCenter: array<u32, ${levels}>,
            heightCenter: array<u32, ${levels}>,
            widthXFace: array<u32, ${levels}>,
            heightXFace: array<u32, ${levels}>,
            widthYFace: array<u32, ${levels}>,
            heightYFace: array<u32, ${levels}>,
            offsetCenter: array<u32, ${offsetEntries}>,
            offsetXFace: array<u32, ${offsetEntries}>,
            offsetYFace: array<u32, ${offsetEntries}>,
            typeCenter: array<i32, ${plate.totalCenter}>,
            typeXFace: array<i32, ${plate.totalXFace}>,
            typeYFace: array<i32, ${plate.totalYFace}>,
            paintCatalystCenter: array<f32, ${plate.totalCenter}>,
            paintPorousXFace: array<f32, ${plate.totalXFace}>,
            paintPorousYFace: array<f32, ${plate.totalYFace}>,
        };

${BUFFER_GROUPS.map(groupStruct).join('\n\n')}

        struct Controls {
${CONTROLS_MEMBERS.map((member) => `            ${member.name}: ${gridControlsType(member, levels)},`).join('\n')}
        };

        struct Coefficients {
${plate.coefficientSlotNames.map((name) => `            ${name}: f32,`).join('\n')}
        };
    `;
}

function gridCapitalized(name) {
    return name.charAt(0).toUpperCase() + name.slice(1);
}

// The Layout buffer is bound as `grid`, because `layout` is a reserved word in
// WGSL; the struct type stays `Layout`, since keywords are case sensitive.
function makeBindingCode(presentationFormat) {
    // language=WGSL
    return `
        @group(0) @binding(0) var canvasTexture: texture_storage_2d<${presentationFormat}, write>;

        @group(1) @binding(0) var<storage, read_write> grid: Layout;
        @group(1) @binding(1) var<storage, read_write> centerState: CenterState;
        @group(1) @binding(2) var<storage, read_write> centerWorkspace: CenterWorkspace;
        @group(1) @binding(3) var<storage, read_write> xFace: XFace;
        @group(1) @binding(4) var<storage, read_write> yFace: YFace;
        @group(1) @binding(5) var<storage, read_write> controls: Controls;
        @group(1) @binding(6) var<storage, read_write> coefficients: Coefficients;
    `;
}

// The shader's index function for one location, from gridIndexExpression.
function gridIndexFunctionCode(name) {
    return `        fn index${name}(level : u32, column : u32, row : u32) -> u32 {
            return ${gridIndexExpression(`grid.offset${name}[level]`, `grid.width${name}[level]`)};
        }`;
}

// The shader's two bounds tests for one location: inside the interior, from
// GRID_EXTRA_ALONG, and inside the stored array.
function gridBoundsFunctionCode(name, location) {
    const last = (axis) => `grid.interior[level]${GRID_EXTRA_ALONG[location][axis] ? ' + 1u' : ''}`;
    return `        fn isInterior${name}(level : u32, column : u32, row : u32) -> bool {
            return column >= 1u && column <= ${last('x')} && row >= 1u && row <= ${last('y')};
        }

        fn isStored${name}(level : u32, column : u32, row : u32) -> bool {
            return column < grid.width${name}[level] && row < grid.height${name}[level];
        }`;
}

// One position function in the shader, from GRID_POINT_OFFSETS.
function gridPositionFunctionCode(kind) {
    const name = gridCapitalized(kind);
    const along = (index, axis) => {
        const offset = gridOffsetAlong(kind, axis);
        return `(f32(${index}) ${offset < 0 ? '-' : '+'} ${wgslLiteral(Math.abs(offset))}) * spacing`;
    };
    return `        fn position${name}(level : u32, column : u32, row : u32) -> vec2f {
            let spacing = grid.spacing[level];
            return vec2f(${along('column', 'x')}, ${along('row', 'y')});
        }`;
}

function makeIndexCode() {
    // language=WGSL
    return `
        const CENTER : u32 = 0u;
        const XFACE  : u32 = 1u;
        const YFACE  : u32 = 2u;

        const FLUID    : i32 = 0;
        const WALL     : i32 = 1;
        const INLET    : i32 = 2;
        const OUTLET   : i32 = 3;
        const SYMMETRY : i32 = 4;
        const INERT    : i32 = 5;

${LOCATION_NAMES.map(({ suffix }) => gridIndexFunctionCode(suffix)).join('\n\n')}

        // Physical position, domain units, interior spanning the unit square,
        // printed from the table positionOf reads.
${LOCATION_NAMES.map(({ kind }) => gridPositionFunctionCode(kind)).join('\n\n')}

        // The tests every kernel opens with: is this point inside the interior
        // (or inside the stored array, ghost ring included), and which color
        // of the red-black sweep is it.
${LOCATION_NAMES.map(({ suffix }, location) => gridBoundsFunctionCode(suffix, location)).join('\n\n')}

        fn isRed(column : u32, row : u32) -> bool {
            return (column + row) % 2u == 0u;
        }

        fn isBlack(column : u32, row : u32) -> bool {
            return (column + row) % 2u == 1u;
        }
    `;
}
