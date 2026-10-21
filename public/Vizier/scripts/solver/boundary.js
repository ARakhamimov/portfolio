// boundary.js, by Allen Rakhamimov.
// The boundary table, keyed on (type, role, field), and the WGSL that fills the
// ghost points from it.
//
// A wall holds velocity at zero and temperature at zero gradient, so the kind of
// condition and its value come from the table, per field. A face normal to the
// boundary lies on it and is written directly; every other ghost lies half a
// cell outside and takes the mirror that puts the boundary value at the average.

'use strict';

const RELAXED       = 0;
const DIRICHLET     = 1;
const NEUMANN       = 2;
const ZERO_GRADIENT = 3;

// Field roles. A field declares one; the table is keyed on it.
const ROLE_SCALAR   = 'scalar';
const ROLE_PRESSURE = 'pressure';
const ROLE_VELOCITY = 'velocity';

// The boundary types a table is keyed on: every type but FLUID.
const BOUNDARY_TYPES = [WALL, INLET, OUTLET, SYMMETRY, INERT];
const BOUNDARY_TYPE_NAMES = ['FLUID', 'WALL', 'INLET', 'OUTLET', 'SYMMETRY', 'INERT'];

// The default table. A heated wall is an override on it, a scalar Dirichlet
// on the wall entry.
function defaultBoundaryTable() {
    const rule = (kind, value = 0) => ({ kind, value });
    const both = (kind, value = 0) => ({ surface: rule(kind, value), tangential: rule(kind, value) });

    return {
        [WALL]: {
            [ROLE_SCALAR]:   both(NEUMANN),
            [ROLE_PRESSURE]: both(NEUMANN),
            [ROLE_VELOCITY]: both(DIRICHLET, 0),   // no-slip: zero on the surface, mirrored tangentially
        },
        [INLET]: {
            [ROLE_SCALAR]:   both(DIRICHLET, 0),
            [ROLE_PRESSURE]: both(NEUMANN),
            [ROLE_VELOCITY]: both(DIRICHLET, 0),
        },
        [OUTLET]: {
            [ROLE_SCALAR]:   both(NEUMANN),
            [ROLE_PRESSURE]: both(DIRICHLET, 0),   // pins the pressure's additive constant
            [ROLE_VELOCITY]: {
                // An unknown the smoother solves, which reads the outlet
                // pressure through its ghost center.
                surface:    rule(RELAXED),
                tangential: rule(ZERO_GRADIENT),
            },
        },
        [SYMMETRY]: {
            [ROLE_SCALAR]:   both(NEUMANN),
            [ROLE_PRESSURE]: both(NEUMANN),
            [ROLE_VELOCITY]: {
                surface:    rule(DIRICHLET, 0),    // no flow through
                tangential: rule(NEUMANN),         // free slip along
            },
        },
        [INERT]: {
            [ROLE_SCALAR]:   both(NEUMANN),
            [ROLE_PRESSURE]: both(NEUMANN),
            [ROLE_VELOCITY]: both(NEUMANN),
        },
    };
}

// An override is per field, since an inlet feeds each species at its own value.
function boundaryRuleFor(table, type, role, field) {
    const byType = table[type];
    if (!byType) return null;
    if (field !== undefined && byType.fields && byType.fields[field]) return byType.fields[field];
    return byType[role] || null;
}

// The types whose surface faces the smoother solves for this field, as a mask.
function relaxedSurfaceMask(table, role, fieldName) {
    let mask = 0;
    for (const type of BOUNDARY_TYPES) {
        const entry = boundaryRuleFor(table, type, role, fieldName);
        if (entry && entry.surface && entry.surface.kind === RELAXED) mask |= (1 << type);
    }
    return mask;
}

// Ports and the perimeter

// How many ports a case may declare (the offset jets use four), and the five
// slots each one owns. Functions and not consts, because the slot list above
// is built from them while this file is still being read.
function boundaryPortCount() { return 6; }

function boundaryPortSlotList() {
    const names = [];
    for (let k = 0; k < boundaryPortCount(); k++) {
        for (const quantity of ['Start', 'End', 'Speed', 'FeedA', 'FeedB']) names.push(`port${quantity}${k}`);
    }
    return names;
}

// Where a point on the ghost ring lies along the perimeter, as one number: the
// left edge runs 0 to 1 top to bottom, the top 1 to 2 left to right, the right
// 2 to 3 top to bottom and the bottom 3 to 4 left to right, so a port is two
// slots. Each piece is a test and the value where it first holds, printed into
// both languages.
const BOUNDARY_PERIMETER_PIECES = [
    { when: 'x <= 0.0', value: 'y' },
    { when: 'x >= 1.0', value: '2.0 + y' },
    { when: 'y <= 0.0', value: '1.0 + x' },
    { when: null, value: '3.0 + x' },
];

const BOUNDARY_PERIMETER_COMPILED = new Function('x', 'y', BOUNDARY_PERIMETER_PIECES.map(({ when, value }) =>
    (when ? `if (${when}) return ${value};` : `return ${value};`)).join('\n'));

function boundaryPerimeterOf(x, y) { return BOUNDARY_PERIMETER_COMPILED(x, y); }

function boundaryPerimeterCode() {
    const lines = BOUNDARY_PERIMETER_PIECES.map(({ when, value }) =>
        (when ? `if (${when}) { return ${value}; }` : `return ${value};`));
    return ['fn boundaryPerimeterOf(position : vec2f) -> f32 {',
        '    let x = position.x;', '    let y = position.y;',
        ...lines.map((line) => `    ${line}`), '}'].join('\n');
}

// The direction an inlet on each edge pushes fluid: into the domain, with y
// running down the screen, so a top inlet's velocity is positive.
const BOUNDARY_PORT_INWARD = [[1, 0], [0, 1], [-1, 0], [0, -1]];
function boundaryPortInward(edge) { return BOUNDARY_PORT_INWARD[edge].slice(); }

// Each port is five slots (boundaryPortSlotList), so moving one is a buffer write.
// Its velocity points into the domain from its edge.
const BOUNDARY_PORT_VALUES = ['xVelocity', 'yVelocity', 'speciesA', 'speciesB'];

function boundaryPortValue(quantity) {
    if (!BOUNDARY_PORT_VALUES.includes(quantity)) {
        throw new Error(`boundaryPortValue: a port carries ${BOUNDARY_PORT_VALUES.join(', ')}, `
            + `not ${quantity}`);
    }
    return { boundaryPort: quantity };
}

function boundaryIsPortValue(value) {
    return !!value && typeof value === 'object' && typeof value.boundaryPort === 'string';
}

// portValue_<quantity>: the value the first port holding this point feeds, and
// zero where none does. Along the perimeter the left edge runs 0 to 1, the top
// 1 to 2, the right 2 to 3 and the bottom 3 to 4 (boundaryPerimeterOf).
function makePortValueCode(quantity) {
    const location = fieldSpecOf(quantity).location;
    const position = positionFunctionAt(location);
    const axis = { xVelocity: 0, yVelocity: 1 }[quantity];

    let inward = '';
    if (axis !== undefined) {
        // language=WGSL
        inward = `
            var inward = 0.0;`;
        for (let edge = 0; edge < 4; edge++) {
            const component = boundaryPortInward(edge)[axis];
            if (component === 0) continue;
            const onEdge = [
                ...(edge > 0 ? [`alongPerimeter >= ${edge}.0`] : []),
                ...(edge < 3 ? [`alongPerimeter < ${edge + 1}.0`] : []),
            ].join(' && ');
            // language=WGSL
            inward += `
            if (${onEdge}) { inward = ${component < 0 ? '(-1.0)' : '1.0'}; }`;
        }
    }

    let ports = '';
    for (let k = 0; k < boundaryPortCount(); k++) {
        const value = axis !== undefined ? `coefficients.portSpeed${k} * inward`
            : `coefficients.port${quantity === 'speciesA' ? 'FeedA' : 'FeedB'}${k}`;
        // language=WGSL
        ports += `
            if (alongPerimeter >= coefficients.portStart${k} && alongPerimeter <= coefficients.portEnd${k}) {
                return ${value};
            }`;
    }

    // language=WGSL
    return `
        fn portValue_${quantity}(level : u32, column : u32, row : u32) -> f32 {
            let position = ${position}(level, column, row);
            var alongPerimeter = boundaryPerimeterOf(position);${inward}${ports}
            return 0.0;
        }
    `;
}

// The WGSL every shader holds once: whether a face lies on a surface (the
// cells either side of it disagree about being fluid), and the port values.
function makeBoundaryHelperCode() {
    // language=WGSL
    return `
        fn xFaceOnSurface(level : u32, column : u32, row : u32) -> bool {
            if ((column == 0u) || (column >= grid.widthCenter[level])) { return false; }
            let cellBehindIsFluid = (grid.typeCenter[indexCenter(level, column - 1u, row)] == FLUID);
            let cellAheadIsFluid  = (grid.typeCenter[indexCenter(level, column, row)] == FLUID);
            return cellBehindIsFluid != cellAheadIsFluid;
        }

        fn yFaceOnSurface(level : u32, column : u32, row : u32) -> bool {
            if ((row == 0u) || (row >= grid.heightCenter[level])) { return false; }
            let cellBehindIsFluid = (grid.typeCenter[indexCenter(level, column, row - 1u)] == FLUID);
            let cellAheadIsFluid  = (grid.typeCenter[indexCenter(level, column, row)] == FLUID);
            return cellBehindIsFluid != cellAheadIsFluid;
        }

        ${boundaryPerimeterCode().split('\n').join('\n        ')}
${BOUNDARY_PORT_VALUES.map(makePortValueCode).join('')}`;
}

// A rule's value as WGSL: a number, a coefficient slot, a port or a profile.
function boundaryValueAsWgsl(value) {
    if (typeof value !== 'object' || value === null) return wgslLiteral(value);
    if (coefficientIsProfile(value)) {
        throw new Error('a boundary value may be a number, a coefficient slot, a port or an (at, wgsl) '
            + `profile, not a coefficient profile (slot ${value.coefficientProfile.slot})`);
    }
    if (coefficientIsSlot(value)) return coefficientCodeOf(value);
    if (boundaryIsPortValue(value)) return `portValue_${value.boundaryPort}(level, column, row)`;
    return `(${value.wgsl})`;
}

// isSolvedPoint_<field>: whether the field's equation solves for this point, or
// the boundary sets it. A fluid point is solved, and so is a surface face of a
// type the table leaves to the smoother (an outflow face).
function makeOwnershipCode(fieldName, location, role, table) {
    const mask = relaxedSurfaceMask(table, role, fieldName);
    const kind = LOCATION_NAMES[location].suffix;
    const relaxed = location === 0 ? [] : BOUNDARY_TYPES.filter((type) => (mask >> type) & 1);
    const surfaceTests = relaxed.map((type) => `
            if (boundaryType == ${BOUNDARY_TYPE_NAMES[type]}) { return ${kind[0].toLowerCase()}${kind.slice(1)}OnSurface(level, column, row); }`).join('');

    // language=WGSL
    return `
        fn isSolvedPoint_${fieldName}(level : u32, column : u32, row : u32) -> bool {
            let boundaryType = grid.type${kind}[index${kind}(level, column, row)];
            if (boundaryType == FLUID) { return true; }${surfaceTests}
            return false;
        }
    `;
}

// fillBoundary_<field>, for one boundary point:
//   - a fluid point is left alone, and a type the table has no entry for gets 0;
//   - a face that lies on a surface takes the surface rule: a Dirichlet value
//     written in, a relaxed face left to the smoother, or else the value of the
//     next face into the fluid;
//   - every other point is a ghost half a cell outside and takes the mirror:
//     the average of the neighbors the smoother owns, reflected through a
//     Dirichlet value (2 value - average) or copied as it is.
function makeFillCode(fieldName, array, location, role, table) {
    const kind = LOCATION_NAMES[location].suffix;
    const index = `index${kind}`;
    const here = `${array}[${index}(level, column, row)]`;
    const entries = BOUNDARY_TYPES.map((type) => ({ name: BOUNDARY_TYPE_NAMES[type],
        rule: boundaryRuleFor(table, type, role, fieldName) }));

    const missing = entries.filter(({ rule }) => !rule).map(({ name }) => `
            if (boundaryType == ${name}) { ${here} = 0.0; return; }`).join('');

    let surface = '';
    if (location !== 0) {
        const axis = location === 1 ? 'column' : 'row';
        const extent = location === 1 ? 'grid.widthXFace[level]' : 'grid.heightYFace[level]';
        const behind = location === 1 ? 'column - 1u, row' : 'column, row - 1u';
        const previousFace = location === 1 ? 'column - 1u, row' : 'column, row - 1u';
        const nextFace = location === 1 ? 'column + 1u, row' : 'column, row + 1u';
        // language=WGSL
        const nextFaceIntoFluid = `
                    if (grid.typeCenter[indexCenter(level, ${behind})] == FLUID) {
                        ${here} = ${array}[${index}(level, ${previousFace})];
                    } else {
                        if (${axis} + 1u < ${extent}) {
                            ${here} = ${array}[${index}(level, ${nextFace})];
                        }
                    }
                    return;`;
        const rules = entries.filter(({ rule }) => rule).map(({ name, rule }) => {
            const { kind: ruleKind, value } = rule.surface;
            // language=WGSL
            if (ruleKind === DIRICHLET) return `
                if (boundaryType == ${name}) { ${here} = ${boundaryValueAsWgsl(value)}; return; }`;
            // A relaxed face is the smoother's: writing it would overwrite the
            // solution with an extrapolation of itself.
            // language=WGSL
            if (ruleKind === RELAXED) return `
                if (boundaryType == ${name}) { return; }`;
            // language=WGSL
            return `
                if (boundaryType == ${name}) {${nextFaceIntoFluid}
                }`;
        }).join('');
        // language=WGSL
        surface = `
            if (${kind[0].toLowerCase()}${kind.slice(1)}OnSurface(level, column, row)) {${rules}
                return;
            }`;
    }

    const mirrors = entries.filter(({ rule }) => rule && rule.tangential.kind === DIRICHLET).map(({ name, rule }) => `
            if (boundaryType == ${name}) { ${here} = 2.0 * ${boundaryValueAsWgsl(rule.tangential.value)} - interior; return; }`).join('');

    // language=WGSL
    const body = `
            let boundaryType = grid.type${kind}[${index}(level, column, row)];
            if (boundaryType == FLUID) { return; }${missing}${surface}
            var sum = 0.0;
            var count = 0.0;
            if (column > 0u) {
                if (isSolvedPoint_${fieldName}(level, column - 1u, row)) {
                    sum = sum + ${array}[${index}(level, column - 1u, row)];
                    count = count + 1.0;
                }
            }
            if (column + 1u < grid.width${kind}[level]) {
                if (isSolvedPoint_${fieldName}(level, column + 1u, row)) {
                    sum = sum + ${array}[${index}(level, column + 1u, row)];
                    count = count + 1.0;
                }
            }
            if (row > 0u) {
                if (isSolvedPoint_${fieldName}(level, column, row - 1u)) {
                    sum = sum + ${array}[${index}(level, column, row - 1u)];
                    count = count + 1.0;
                }
            }
            if (row + 1u < grid.height${kind}[level]) {
                if (isSolvedPoint_${fieldName}(level, column, row + 1u)) {
                    sum = sum + ${array}[${index}(level, column, row + 1u)];
                    count = count + 1.0;
                }
            }
            if (count == 0.0) { ${here} = 0.0; return; }
            let interior = sum / count;${mirrors}
            ${here} = interior;`;
    // language=WGSL
    const position = /\bposition\b/.test(body) ? `
            let position = position${kind}(level, column, row);` : '';

    // language=WGSL
    return `
        fn fillBoundary_${fieldName}(level : u32, column : u32, row : u32) {${position}${body}
        }
    `;
}

// Both functions for one field.
function makeBoundaryCode(fieldName, arrayName, location, role, table) {
    return makeOwnershipCode(fieldName, location, role, table)
        + makeFillCode(fieldName, arrayName, location, role, table);
}
