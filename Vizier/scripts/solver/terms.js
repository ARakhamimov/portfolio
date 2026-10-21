// terms.js, by Allen Rakhamimov.
// The dictionary of discretized PDE terms, and the WGSL functions its entries
// share.
//
// Each entry gives its value at a point as WGSL, and its diagonal: how much the
// value changes when the point's own value goes up by one. Neighbors are left,
// right, above and below; rows count down the screen, so above is row - 1.
// Each entry also says how the term is written on the equation panel.

'use strict';

// Keyed by the name a case declares. q is the array the equation solves; the
// term's coefficients and other fields arrive already written as WGSL. Each
// entry has:
//   describe(c)      the sign the term enters du/dt = ... with, and its body,
//                    for the panel
//   value(q, args)   the term at a point, as WGSL
//   diagonal         its slope in the point's own value, where it has one
// and, where it needs them:
//   problem(term, location)    why the term cannot be written on a row at that
//                              location, or null
//   arguments(term, args, location, level)   the WGSL arguments past the
//                              coefficients and fields termAsWgsl writes
//   schurDiagonal(term, equation, coefficient)   its part of a face row's
//                              diagonal, for Schur relaxation
//   reaction(field, term)      which species it consumes or produces, and the
//                              factors its rate multiplies, for the reaction line
const TERM_DICTIONARY = {

    // du/dt, which the equation code applies once to the sum of the terms.
    timeDerivative: {
        describe: (c) => ({ side: 'left', body: `∂${c.symbol}/∂t` }),
        schurDiagonal: (term, equation) => wgslNumber(1 / equation.timeStep),
    },

    // D lap q, the five-point Laplacian times a diffusivity D. A D that varies
    // takes the face form, the sum of D_face (q_neighbor - q) / h^2, each D_face
    // read where its face is.
    diffusion: {
        describe(c) {
            const param = c.params.diffusivity;
            if (!fluxCoefficientVaries(param)) {
                return { sign: '+', body: `${c.coefficient(param, 'diffusivity')} ∇^2${c.symbol}` };
            }
            const D = rateIsArrhenius(param)
                ? `${c.coefficient(param.arrhenius.rate, 'diffusivity')}(${c.fieldSymbol(param.arrhenius.field)})`
                : c.coefficient(param, 'diffusivity');
            return { sign: '+', body: `∇·(${D} ∇${c.symbol})` };
        },
        value: (q, { diffusivity, faceDiffusivity: D }) => (D
            ? `(${D.left} * (${q}[left] - ${q}[here])
                    + ${D.right} * (${q}[right] - ${q}[here])
                    + ${D.above} * (${q}[above] - ${q}[here])
                    + ${D.below} * (${q}[below] - ${q}[here])) / (spacing * spacing)`
            : `${diffusivity} * (${q}[left] + ${q}[right] + ${q}[above] + ${q}[below] - 4.0 * ${q}[here]) / (spacing * spacing)`),
        diagonal: (q, { diffusivity, faceDiffusivity: D }) => (D
            ? `-(${D.left} + ${D.right} + ${D.above} + ${D.below}) / (spacing * spacing)`
            : `-4.0 * ${diffusivity} / (spacing * spacing)`),
        problem(term, location) {
            if (coefficientIsPainted(term.diffusivity)) return TERM_PAINTED_FLUX_PROBLEM;
            if (fluxCoefficientVaries(term.diffusivity) && location !== 'center') {
                return 'its diffusivity varies on a row at faces; the face form serves rows at cell centers, '
                    + 'and a varying viscosity needs the full stress, which no entry carries';
            }
            return null;
        },
        arguments(term, args, location, level) {
            if (!fluxCoefficientVaries(term.diffusivity)) return;
            delete args.diffusivity;
            args.faceDiffusivity = faceDiffusivityAsWgsl(term.diffusivity, level);
        },
        schurDiagonal: (term, equation, coefficient) =>
            `${wgslNumber(equation.theta * 4)} * ${coefficient(term.diffusivity)} / (spacing * spacing)`,
    },

    // -(u . grad) q, bounded advection (the advection function below).
    // The diagonal is the upwind part only: the central part would cancel it.
    advection: {
        describe: (c) => ({ sign: '-', body: `(${c.vector([c.params.xField, c.params.yField])}·∇)${c.symbol}` }),
        value: (q, { velocityX, velocityY, diffusivity }) => `advection(${velocityX}, ${velocityY}, ${q}[here], ${q}[left], ${q}[right], ${q}[above], ${q}[below], ${diffusivity}, spacing)`,
        diagonal: (q, { velocityX, velocityY }) => `-(abs(${velocityX}) + abs(${velocityY})) / spacing`,
        problem(term) {
            if (coefficientIsPainted(term.diffusivity)) return TERM_PAINTED_FLUX_PROBLEM;
            if (term.boundedness !== 'hybrid') return 'advection is bounded, so it declares boundedness: \'hybrid\'';
            if (!coefficientIsOneNumber(term.diffusivity) || term.diffusivity === undefined) {
                return 'the blend reads its diffusivity as one number, so it needs a uniform diffusivity';
            }
            return null;
        },
        arguments(term, args, location, level) {
            args.velocityX = velocityAt(term.xField, location, level);
            args.velocityY = velocityAt(term.yField, location, level);
        },
    },

    // -dphi/dx or -dphi/dy at a face, from the two centers either side of it.
    gradientOf: {
        describe: (c) => ({ sign: '-',
            body: `∂${c.fieldSymbol(c.params.field)}/∂${c.params.component === 'y' ? 'y' : 'x'}` }),
        value: (q, { field, component }) => (component === 'y'
            ? `-(${field}[indexCenter(level, column, row)] - ${field}[indexCenter(level, column, row - 1u)]) / spacing`
            : `-(${field}[indexCenter(level, column, row)] - ${field}[indexCenter(level, column - 1u, row)]) / spacing`),
        problem: (term, location) => (fieldStoredAt(term.field) === 'center' && location !== 'center'
            ? null : 'a gradient of a center field, on a row at faces'),
    },

    // -div u at a center, from the four faces around it.
    divergenceOf: {
        describe: (c) => ({ sign: '-', body: `∇·${c.vector([c.params.xField, c.params.yField])}` }),
        value: (q, { xField, yField }) => `-((${xField}[indexXFace(level, column + 1u, row)] - ${xField}[indexXFace(level, column, row)]) + (${yField}[indexYFace(level, column, row + 1u)] - ${yField}[indexYFace(level, column, row)])) / spacing`,
        problem: (term, location) => (location === 'center'
            && fieldStoredAt(term.xField) === 'xFace' && fieldStoredAt(term.yField) === 'yFace'
            ? null : 'a divergence of a face pair, on a row at cell centers'),
    },

    // +/-S, a number, a slot or a function of position, with an optional region
    // weight w(x, y).
    source: {
        describe(c) {
            const S = c.coefficient(c.params.value, 'source');
            const weight = c.params.at ? ` ${c.params.weightSymbol || 'w(x, y)'}` : '';
            return { sign: sourceSign(c.params),
                body: (typeof c.params.value === 'function') ? `${S}(x, y)` : `${S}${weight}` };
        },
        value: (q, { value, weight, sign }) => `${sign === '-' ? '-' : ''}${value}${weight ? ` * ${weight}` : ''}`,
        arguments(term, args) {
            args.sign = sourceSign(term);
            if (typeof term.value === 'function') args.value = termsProfileAsWgsl(term);
            else {
                args.value = coefficientAsWgsl(term.value);
                if (term.at) args.weight = termsProfileAsWgsl(term);
            }
        },
    },

    // k w (target - q), a feed over a region, or over the whole domain with no
    // weight. Its slope in q is -k w, so a strong feed holds q at the target.
    regionSource: {
        describe(c) {
            const weight = c.params.at ? ' w(x, y)' : '';
            return { sign: '+', body: `${c.rate(c.params.rate)}${weight} (${c.value(c.params.target)} − ${c.symbol})` };
        },
        value: (q, { rate, weight, target }) => `${rate}${weight ? ` * ${weight}` : ''} * (${target} - ${q}[here])`,
        diagonal: (q, { rate, weight }) => `-${rate}${weight ? ` * ${weight}` : ''}`,
        arguments(term, args) {
            if (term.at) args.weight = termsProfileAsWgsl(term);
        },
    },

    // -k q.
    firstOrderSink: {
        describe: (c) => ({ sign: '-', body: `${c.rate(c.params.rate)} ${c.symbol}` }),
        value: (q, { rate }) => `-${rate} * ${q}[here]`,
        diagonal: (q, { rate }) => `-${rate}`,
        schurDiagonal: (term, equation, coefficient) => `${wgslNumber(equation.theta)} * ${coefficient(term.rate)}`,
        reaction: (field) => ({ consumes: field, factors: [field] }),
    },

    // -k q^2.
    // The diagonal is k q, not the derivative 2 k q: q^2 is taken as (k q) q.
    secondOrderSink: {
        describe: (c) => ({ sign: '-', body: `${c.rate(c.params.rate)} ${c.symbol}^2` }),
        value: (q, { rate }) => `-${rate} * ${q}[here] * ${q}[here]`,
        diagonal: (q, { rate }) => `-${rate} * ${q}[here]`,
        reaction: (field) => ({ consumes: field, factors: [field, field] }),
    },

    // -k q times its partners, mass action on a species consumed.
    reactionSink: {
        describe: (c) => ({ sign: '-', body: `${c.rate(c.params.rate)} ${c.symbol} ${c.product(c.params.partners)}` }),
        value: (q, { rate, partners }) => `-${rate} * ${q}[here] * ${partners.join(' * ')}`,
        diagonal: (q, { rate, partners }) => `-${rate} * ${partners.join(' * ')}`,
        reaction: (field, term) => ({ consumes: field, factors: [field, ...term.partners] }),
    },

    // +k times the reactants, mass action on a species formed.
    reactionSource: {
        describe: (c) => ({ sign: '+', body: `${c.rate(c.params.rate)} ${c.product(c.params.reactants)}` }),
        value: (q, { rate, reactants }) => `${rate} * ${reactants.join(' * ')}`,
        reaction: (field, term) => ({ produces: field, factors: [...term.reactants] }),
    },

    // -k q (partner) / (K + q): Michaelis-Menten with no partner, Monod with one.
    // The saturation reads max(q, 0), so ringing below -K cannot flip the
    // diagonal's sign, and the diagonal is the rate over the saturation, not
    // the derivative.
    saturatingSink: {
        describe(c) {
            const K = c.coefficient(c.params.halfSaturation, 'halfSaturation');
            const partner = c.params.partner ? ` ${c.fieldSymbol(c.params.partner)}` : '';
            return { sign: '-', body: `${c.rate(c.params.rate)} ${c.symbol}${partner} / (${K} + ${c.symbol})` };
        },
        value: (q, { rate, partner, halfSaturation }) => `-${rate} * ${q}[here]${partner ? ` * max(${partner}, 0.0)` : ''} / (${halfSaturation} + max(${q}[here], 0.0))`,
        diagonal: (q, { rate, partner, halfSaturation }) => `-${rate}${partner ? ` * max(${partner}, 0.0)` : ''} / (${halfSaturation} + max(${q}[here], 0.0))`,
        reaction: (field, term) => ({ consumes: field, factors: [field, term.partner] }),
    },

    // +k s (partner) / (K + s), Monod growth on a substrate s, read as max(s, 0).
    saturatingSource: {
        describe(c) {
            const K = c.coefficient(c.params.halfSaturation, 'halfSaturation');
            const s = c.fieldSymbol(c.params.substrate);
            const partner = c.params.partner ? ` ${c.fieldSymbol(c.params.partner)}` : '';
            return { sign: '+', body: `${c.rate(c.params.rate)} ${s}${partner} / (${K} + ${s})` };
        },
        value: (q, { rate, substrate, partner, halfSaturation }) => `${rate} * max(${substrate}, 0.0)${partner ? ` * max(${partner}, 0.0)` : ''} / (${halfSaturation} + max(${substrate}, 0.0))`,
        reaction: (field, term) => ({ produces: field, factors: [term.substrate, term.partner] }),
    },

    // +/-k (phi - phi_ref), another field phi averaged to this row's points: the
    // Boussinesq force, a heavy species' weight, the induction equation's
    // velocity source, a potential V(x, y) on a wave function.
    proportionalSource: {
        describe(c) {
            const phi = c.fieldSymbol(c.params.field);
            const weight = c.params.weight ? ` ${c.params.weightSymbol || 'w(x, y)'}` : '';
            const k = (c.params.weight && c.params.coefficient === 1)
                ? weight.trim() : `${c.coefficient(c.params.coefficient, 'coupling')}${weight}`;
            const reference = c.params.reference || 0;
            return { sign: proportionalSign(c.params),
                body: reference === 0 ? `${k} ${phi}` : `${k} (${phi} − ${c.value(reference)})` };
        },
        value: (q, { sign, coefficient, weight, fieldHere, reference }) => `${sign === '-' ? '-' : ''}${coefficient}${weight ? ` * ${weight}` : ''} * ${reference ? `(${fieldHere} - ${wgslLiteral(reference)})` : fieldHere}`,
        arguments(term, args, location, level) {
            args.sign = proportionalSign(term);
            args.fieldHere = fieldAtRow(term.field, location, level);
            if (term.weight) args.weight = termsProfileAsWgsl(term.weight);
        },
    },

    // +/-D lap phi, another field stored where this row is: how the real and
    // imaginary parts of a wave function drive each other.
    laplacianOf: {
        describe: (c) => ({ sign: proportionalSign(c.params, 'laplacianOf'),
            body: `${c.coefficient(c.params.coefficient, 'dispersion')} ∇^2${c.fieldSymbol(c.params.field)}` }),
        value: (q, { sign, coefficient, field }) => `${sign === '-' ? '-' : ''}${coefficient} * (${field}[left] + ${field}[right] + ${field}[above] + ${field}[below] - 4.0 * ${field}[here]) / (spacing * spacing)`,
        problem: (term, location) => (fieldStoredAt(term.field) === location && coefficientIsOneNumber(term.coefficient)
            ? null : 'a Laplacian of a field stored where the row is, with a uniform coefficient'),
        arguments(term, args) {
            args.sign = proportionalSign(term, 'laplacianOf');
        },
    },

    // -(lap A) dA/dx or dA/dy at a face, the Lorentz force in two dimensions, with
    // A the induced potential plus the applied field's. The Laplacian at a face
    // is the average of the two centers', and a center outside the interior is
    // replaced by its interior neighbor, so nothing reads past the ghost ring.
    lorentzForce: {
        describe: (c) => ({ sign: '-',
            body: `(∇^2${c.fieldSymbol(c.params.field)}) ∂A/∂${c.params.component === 'y' ? 'y' : 'x'}` }),
        value: (q, { field, laplacian, component, applied }) => {
            const [minus, plus] = component === 'y'
                ? [['column', 'row - 1u'], ['column', 'row']] : [['column - 1u', 'row'], ['column', 'row']];
            const clamped = ([column, row]) => (component === 'y'
                ? `${column}, clamp(${row}, 1u, grid.interior[level])`
                : `clamp(${column}, 1u, grid.interior[level]), ${row}`);
            const at = ([column, row]) => `${field}[indexCenter(level, ${column}, ${row})]`;
            return `-0.5 * (${laplacian}(level, ${clamped(plus)}) + ${laplacian}(level, ${clamped(minus)}))
                    * ((${at(plus)} - ${at(minus)}) / spacing + ${applied})`;
        },
        problem: (term, location) => (fieldStoredAt(term.field) === 'center' && location !== 'center'
            ? null : 'the force from a center potential, on a row at faces'),
        arguments(term, args, location, level) {
            const sign = lorentzAppliedSign(term.along, term.component === 'y');
            args.applied = sign === 0 ? '0.0' : sign > 0 ? args.applied : `(-${args.applied})`;
            args.laplacian = centerLaplacianName(term.field, level);
        },
    },
};

// A coefficient inside a flux may vary only where the face form serves it, and
// a painted one is read at a point.
const TERM_PAINTED_FLUX_PROBLEM = 'its diffusivity is painted; a painted coefficient is read at a point, '
    + 'and one inside a flux would have to be averaged between points';

// The WGSL functions the entries call, once per shader. The blend is
// min(1, 2 D / (|u| h)); the max() keeps select's unused branch from 0 / 0.
function makeDiscretizationFunctionCode(system) {
    // language=WGSL
    return `
        fn advectionBlend(velocity : f32, diffusivity : f32, spacing : f32) -> f32 {
            let cellFlux = abs(velocity) * spacing;
            return select(2.0 * diffusivity / max(cellFlux, 1e-30), 1.0, cellFlux <= 2.0 * diffusivity);
        }

        fn advection(velocityX : f32, velocityY : f32,
                     here : f32, left : f32, right : f32, above : f32, below : f32,
                     diffusivity : f32, spacing : f32) -> f32 {
            let upwindX  = (max(velocityX, 0.0) * (left - here) + max(-velocityX, 0.0) * (right - here)) / spacing;
            let upwindY  = (max(velocityY, 0.0) * (above - here) + max(-velocityY, 0.0) * (below - here)) / spacing;
            let centralX = -velocityX * (right - left) / (2.0 * spacing);
            let centralY = -velocityY * (below - above) / (2.0 * spacing);
            let blendX = advectionBlend(velocityX, diffusivity, spacing);
            let blendY = advectionBlend(velocityY, diffusivity, spacing);
            return (upwindX + blendX * (centralX - upwindX)) + (upwindY + blendY * (centralY - upwindY));
        }
    ` + makeCenterLaplacianCode(system);
}

// laplacianAtCenter_<array>: the five-point Laplacian of a center array, one
// function per array the Lorentz force reads, since WGSL cannot take an array
// as a parameter.
function makeCenterLaplacianCode(system) {
    const fields = new Set();
    for (const equation of (system ? system.equations : [])) {
        for (const term of equation.terms) if (term.term === 'lorentzForce') fields.add(term.field);
    }
    const functions = [];
    for (const field of fields) {
        for (const level of ['new', 'old']) {
            const array = arrayAtLevel(field, level);
            // language=WGSL
            functions.push(`
        fn ${centerLaplacianName(field, level)}(level : u32, column : u32, row : u32) -> f32 {
            return (${array}[indexCenter(level, column + 1u, row)] + ${array}[indexCenter(level, column - 1u, row)]
                + ${array}[indexCenter(level, column, row + 1u)] + ${array}[indexCenter(level, column, row - 1u)]
                - 4.0 * ${array}[indexCenter(level, column, row)]) / (grid.spacing[level] * grid.spacing[level]);
        }`);
        }
    }
    return functions.join('\n');
}

function centerLaplacianName(field, level) {
    return `laplacianAtCenter${level === 'old' ? 'Old' : ''}_${field}`;
}

// Rates that depend on a field. The linearized Arrhenius form,
// k(T) = k0 exp(s (T - T0)), with T0 a literal fixed by the case's feed.
function arrheniusRate({ rate, sensitivity, reference, field = 'temperature' }) {
    if (rate === undefined || sensitivity === undefined || reference === undefined) {
        throw new Error('arrheniusRate needs rate, sensitivity and reference');
    }
    return { arrhenius: { rate, sensitivity, reference, field } };
}

function rateIsArrhenius(param) {
    return !!param && typeof param === 'object' && !!param.arrhenius;
}

// A diffusivity that takes the face form: one that varies in space or with
// the temperature.
function fluxCoefficientVaries(param) {
    return coefficientIsProfile(param) || rateIsArrhenius(param);
}

// A source's declared sign, '+' when it declares none.
function sourceSign(params) {
    const sign = params.sign === undefined ? '+' : params.sign;
    if (sign !== '+' && sign !== '-') throw new Error(`source: sign is '+' or '-', not ${sign}`);
    return sign;
}

// A sign the case has to declare, since its coefficient is a slot that stays
// positive.
function proportionalSign(params, entry = 'proportionalSource') {
    if (params.sign !== '+' && params.sign !== '-') {
        throw new Error(`${entry}: \`sign\` must be "+" or "-", declared by the case`);
    }
    return params.sign;
}

// Why a term cannot be written at this row, or null when it can (each entry's
// problem). On a momentum row a varying viscosity needs the full stress, and
// advection's blend reads its diffusivity as one number.
function termProblem(term, equation) {
    const entry = TERM_DICTIONARY[term.term];
    if (entry === undefined) return 'no such term in the dictionary';
    return entry.problem ? entry.problem(term, LOCATION_NAMES[equation.location].kind) : null;
}

// A number, written in, or a slider's slot, read from the coefficients buffer.
function coefficientIsOneNumber(coefficient) {
    if (coefficient === undefined || typeof coefficient === 'number') return true;
    return coefficientIsSlot(coefficient)
        && !coefficientIsProfile(coefficient)
        && !coefficientIsPainted(coefficient);
}

// A number, a slot, a profile or a painted array, by the resolver in coefficients.js.
function coefficientAsWgsl(coefficient) {
    if (coefficient === undefined) return '1.0';
    return coefficientCodeOf(coefficient, 'here');
}

// A rate at one time level: the Arrhenius form reads the temperature at the
// same level, so the theta method's two halves are one operator.
function rateAsWgsl(rate, level) {
    if (!rateIsArrhenius(rate)) return coefficientAsWgsl(rate);
    const { rate: k0, sensitivity, reference, field } = rate.arrhenius;
    return `(${coefficientAsWgsl(k0)} * exp(${coefficientAsWgsl(sensitivity)} * (${arrayAtLevel(field, level)}[here] - ${wgslLiteral(reference)})))`;
}

// A profile's WGSL moved half a cell, for a coefficient read at a face.
function termsProfileAtOffset(wgsl, offsetX, offsetY) {
    const shifted = (axis, offset) => (offset === 0 ? `position.${axis}`
        : `(position.${axis} ${offset < 0 ? '-' : '+'} ${Math.abs(offset)} * spacing)`);
    return wgsl.replace(/position\.x/g, shifted('x', offsetX)).replace(/position\.y/g, shifted('y', offsetY));
}

// The four faces of a cell, each named for the neighbor across it.
const CELL_FACES = { left: [-0.5, 0], right: [0.5, 0], above: [0, -0.5], below: [0, 0.5] };

// A varying diffusivity on each face of this cell. A profile is read at the
// face, and the Arrhenius form at the plain average of the two centers'
// temperatures, so no coefficient is averaged between points.
function faceDiffusivityAsWgsl(param, level) {
    const atFace = (coefficient, [offsetX, offsetY]) => {
        if (!coefficientIsProfile(coefficient)) return coefficientAsWgsl(coefficient);
        const { base, wgsl } = coefficient.coefficientProfile;
        return `(${coefficientAsWgsl(base)} * (${termsProfileAtOffset(wgsl, offsetX, offsetY)}))`;
    };
    const faces = {};
    for (const [neighbor, offset] of Object.entries(CELL_FACES)) {
        if (!rateIsArrhenius(param)) {
            faces[neighbor] = atFace(param, offset);
            continue;
        }
        const { rate, sensitivity, reference, field } = param.arrhenius;
        const temperature = arrayAtLevel(field, level);
        faces[neighbor] = `${atFace(rate, offset)} * exp(${coefficientAsWgsl(sensitivity)} * (0.5 * (${temperature}[here] + ${temperature}[${neighbor}]) - ${wgslLiteral(reference)}))`;
    }
    return faces;
}

function fieldStoredAt(name) {
    return LOCATION_NAMES[fieldSpecOf(name).location].kind;
}

function fieldKeepsOldLevel(name) {
    return Boolean(arrayNamesOfField(name).history);
}

// The pressure has no old level, so it is read at the new one.
function arrayAtLevel(name, level) {
    const arrays = arrayNamesOfField(name);
    return (level === 'old' && arrays.history) ? arrays.history : arrays.value;
}

// The velocity averaged to each location, by the functions in operators.js.
const VELOCITY_AVERAGED_TO = {
    center: { xVelocity: 'xFaceToCenter', yVelocity: 'yFaceToCenter' },
    xFace:  { yVelocity: 'yFaceToXFace' },
    yFace:  { xVelocity: 'xFaceToYFace' },
};

function velocityAt(field, location, level) {
    if (fieldStoredAt(field) === location) return `${arrayAtLevel(field, level)}[here]`;
    const average = VELOCITY_AVERAGED_TO[location][field];
    if (average === undefined) throw new Error(`advection: nothing brings ${field} to the ${location} points`);
    return `${average}${level === 'old' ? 'Old' : ''}(level, column, row)`;
}

// Any field at this row's points: in place, or the plain average of the two
// points of its own location either side. A face field on a face row is refused.
function fieldAtRow(name, location, level) {
    const array = arrayAtLevel(name, level);
    const stored = fieldStoredAt(name);
    if (stored === location) return `${array}[here]`;
    const average = (minus, plus) => `0.5 * (${array}[${minus}] + ${array}[${plus}])`;
    if (stored === 'center' && location === 'xFace') {
        return average('indexCenter(level, column - 1u, row)', 'indexCenter(level, column, row)');
    }
    if (stored === 'center' && location === 'yFace') {
        return average('indexCenter(level, column, row - 1u)', 'indexCenter(level, column, row)');
    }
    if (stored === 'xFace' && location === 'center') {
        return average('indexXFace(level, column, row)', 'indexXFace(level, column + 1u, row)');
    }
    if (stored === 'yFace' && location === 'center') {
        return average('indexYFace(level, column, row)', 'indexYFace(level, column, row + 1u)');
    }
    throw new Error(`${name} is stored on faces and so is this row; only a center field is averaged to a face row`);
}

// A profile of position, in parentheses.
function termsProfileAsWgsl(profile) {
    return `(${profile.wgsl})`;
}

// The term as declared, with its coefficients and fields written as WGSL at
// one time level: what an entry's value and diagonal are given. The entry's
// own arguments come last, from what is written here.
function termAsWgsl(term, equation, level) {
    const location = LOCATION_NAMES[equation.location].kind;
    const written = { ...term };
    for (const key of ['diffusivity', 'target', 'halfSaturation', 'coefficient', 'applied']) {
        if (key in term) written[key] = coefficientAsWgsl(term[key]);
    }
    if ('rate' in term) written.rate = rateAsWgsl(term.rate, level);
    for (const key of ['field', 'xField', 'yField']) {
        if (key in term) written[key] = arrayAtLevel(term[key], level);
    }
    for (const key of ['substrate', 'partner']) {
        if (term[key]) written[key] = `${arrayAtLevel(term[key], level)}[here]`;
    }
    if (term.partners) written.partners = term.partners.map((name) => `${arrayAtLevel(name, level)}[here]`);
    if (term.reactants) written.reactants = term.reactants.map((name) => `${arrayAtLevel(name, level)}[here]`);
    const entry = TERM_DICTIONARY[term.term];
    if (entry.arguments) entry.arguments(term, written, location, level);
    return written;
}

// The sign of the applied field's part of dA/dx (component false) or dA/dy
// (true), for a uniform field along x (A0 = B0 y) or along y (A0 = -B0 x).
function lorentzAppliedSign(along, component) {
    if (along !== 'x' && along !== 'y') {
        throw new Error('lorentzForce: `along`, the applied field\'s direction, is "x" or "y"');
    }
    if (along === 'x') return component ? 1 : 0;
    return component ? 0 : -1;
}

// Every field a term reads, its rate's temperature included.
function fieldsReadBy(term) {
    const rateField = rateIsArrhenius(term.rate) ? term.rate.arrhenius.field : undefined;
    const diffusivityField = rateIsArrhenius(term.diffusivity) ? term.diffusivity.arrhenius.field : undefined;
    return [term.field, term.xField, term.yField, term.substrate, term.partner, rateField, diffusivityField,
        ...(term.partners || []), ...(term.reactants || [])]
        .filter((name) => name !== undefined);
}
