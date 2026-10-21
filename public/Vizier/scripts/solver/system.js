// system.js, by Allen Rakhamimov.
// Several equations solved together, and the scheme each system is relaxed by.
//
// The relaxation scheme lives in the smoother and never in N, whose constraint
// row has a diagonal of exactly 0 in pressure. The FAS right-hand side and the
// divergence view both depend on that.

'use strict';

// Schur relaxation steps the constraint row alone; every other row keeps its
// pointwise solve. A system with no constraint row is relaxed pointwise.
const SCHUR_RELAXATION = 'schurRelaxation';
const POINTWISE = 'pointwise';

// A system:
//   {
//     name: 'stokes',
//     equations: [ momentumX, momentumY, continuity ],
//     relaxation: { scheme: SCHUR_RELAXATION, c: 0.5 },
//   }
function normalizeSystem(spec) {
    const relaxation = spec.relaxation || { scheme: POINTWISE };
    const equations = spec.equations.map((equation) => normalizeEquation(equation));

    const constraints = equations.filter((equation) => equation.constraint);
    if (relaxation.scheme !== POINTWISE && relaxation.scheme !== SCHUR_RELAXATION) {
        throw new Error(`no relaxation scheme named ${relaxation.scheme}; a system is relaxed `
            + `${POINTWISE} or by ${SCHUR_RELAXATION}`);
    }
    if (relaxation.scheme === SCHUR_RELAXATION && constraints.length !== 1) {
        throw new Error(`Schur relaxation expects exactly one constraint row, found ${constraints.length}`);
    }
    if (relaxation.scheme === POINTWISE && constraints.length !== 0) {
        throw new Error('a constraint row cannot be relaxed pointwise: its diagonal in N is zero by construction');
    }
    return { name: spec.name || 'system', equations, relaxation: { ...relaxation } };
}

// The face rows a constraint row's divergence reads, each with its axis.
function schurFaces(system, constraint) {
    const divergence = constraint.terms.find((term) => term.term === 'divergenceOf');
    if (!divergence) {
        throw new Error(`constraint row ${constraint.field} has no divergenceOf term, so `
            + 'Schur relaxation has no faces to scale its step by');
    }
    const faces = [];
    for (const [axis, field] of [['x', divergence.xField], ['y', divergence.yField]]) {
        const equation = system.equations.find((candidate) => candidate.field === field);
        if (!equation) continue;
        if (schurDiagonalTerms(equation).length === 0) {
            throw new Error(`Schur relaxation: row ${field} carries no diffusion, time derivative `
                + 'or first order sink, so it has no diagonal to scale the constraint step by');
        }
        faces.push({ axis, equation });
    }
    return faces;
}

// The terms of a face row that put something in its diagonal (each entry's
// schurDiagonal).
function schurDiagonalTerms(equation) {
    return equation.terms.filter((term) => TERM_DICTIONARY[term.term].schurDiagonal);
}

// A face row's diagonal, 1/dt + theta 4 D / h^2 + theta k, each piece in the
// order the row declares it and each coefficient read where the face is.
function schurFaceDiagonalCode(equation) {
    const coefficient = (param) => (typeof param === 'number' ? wgslNumber(param) : coefficientCodeOf(param));
    return schurDiagonalTerms(equation)
        .map((term) => TERM_DICTIONARY[term.term].schurDiagonal(term, equation, coefficient)).join(' + ');
}

// schurDiagonal_<face field> for each face row, and relaxConstraint_<field>:
// Richardson on the constraint row, p = p + step r, with the step taken per
// point as c h^2 over the summed compliance 1/d of the four faces the row's
// divergence reads. A face the system does not solve adds nothing; a
// prescribed face is counted, which errs toward a smaller step.
function makeSystemCode(system, arrayNamesFor) {
    if (system.relaxation.scheme !== SCHUR_RELAXATION) return '';
    const constraint = system.equations.find((equation) => equation.constraint);
    const faces = schurFaces(system, constraint);
    const c = system.relaxation.c !== undefined ? system.relaxation.c : 0.5;
    const pressure = arrayNamesFor(constraint).value;

    const diagonals = faces.map(({ equation }) => {
        const kind = LOCATION_NAMES[equation.location].suffix;
        const diagonal = schurFaceDiagonalCode(equation);
        // p only where a painted coefficient reads it.
        // language=WGSL
        const index = /\[p\]/.test(diagonal) ? `
            let p = index${kind}(level, column, row);` : '';
        // language=WGSL
        return `
        fn schurDiagonal_${equation.field}(level : u32, column : u32, row : u32) -> f32 {
            let spacing = grid.spacing[level];
            let position = position${kind}(level, column, row);${index}
            return ${diagonal};
        }
    `;
    }).join('');

    const compliance = faces.flatMap(({ axis, equation }) => [
        `1.0 / schurDiagonal_${equation.field}(level, column, row)`,
        `1.0 / schurDiagonal_${equation.field}(level, ${axis === 'x' ? 'column + 1u, row' : 'column, row + 1u'})`,
    ]).join('\n                           + ');

    // language=WGSL
    return `${diagonals}
        fn relaxConstraint_${constraint.field}(level : u32, column : u32, row : u32) {
            let p = indexCenter(level, column, row);
            if (!isSolvedPoint_${constraint.field}(level, column, row)) { return; }
            let spacing = grid.spacing[level];
            let compliance = ${compliance};
            let step = ${wgslLiteral(c)} * spacing * spacing / compliance;
            ${pressure}[p] = ${pressure}[p] + step * residual_${constraint.field}(level, column, row);
        }
    `;
}

// The velocity pair whose divergence the system constrains to zero, or null.
// A stream function is built only from such a pair, so the electric and
// magnetic cases get none.
function divergenceFreePair(system) {
    for (const equation of system.equations) {
        if (!equation.constraint) continue;
        const divergence = equation.terms.find((t) => t.term === 'divergenceOf');
        if (!divergence || divergence.xField !== 'xVelocity') continue;
        if (equation.terms.length === 1) return { x: divergence.xField, y: divergence.yField };
    }
    return null;
}
