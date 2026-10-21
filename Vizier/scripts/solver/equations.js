// equations.js, by Allen Rakhamimov.
// An equation as a case declares it, its defaults filled and its terms
// checked, and one row's WGSL under the theta method.
//
// The terms themselves, as WGSL, are the dictionary in terms.js; this file adds
// them up at both time levels and divides by the diagonal.

'use strict';

// An equation as a case declares it:
//
//   { field: 'temperature', location: CENTER, role: 'scalar', steady: false,
//     theta: 0.55, terms: [{ term: 'diffusion', diffusivity: 0.02 }, ...] }
//
// role picks the boundary table's column; the time derivative is inserted for
// every unsteady row.
function normalizeEquation(spec) {
    const terms = spec.terms.slice();
    const location = spec.location !== undefined ? spec.location : CENTER;

    // Declared as well as inserted, it would count 1/dt twice.
    if (terms.some((term) => term.term === 'timeDerivative')) {
        throw new Error(`equation for ${spec.field} declares timeDerivative; it is inserted for every `
            + 'unsteady field, so declaring it double counts. Set steady to opt out instead.');
    }
    if (!spec.steady && !spec.constraint) terms.unshift({ term: 'timeDerivative' });

    const equation = {
        field: spec.field,
        // Declared and never inferred.
        constraint: !!spec.constraint,
        location,
        role: spec.role || 'scalar',
        steady: !!spec.steady,
        theta: spec.steady ? 1 : (spec.theta !== undefined ? spec.theta : 0.5),
        timeStep: spec.timeStep !== undefined ? spec.timeStep : Infinity,
        terms,
    };
    for (const term of terms) {
        const problem = termProblem(term, equation);
        if (problem) throw new Error(`${term.term} in the equation for ${spec.field}: ${problem}`);
    }
    return equation;
}

// One term to a line, a leading minus written as a subtraction.
function sumOnLines(terms) {
    return terms.map((term, k) => {
        if (k === 0) return term;
        return term.startsWith('-') ? `\n                - ${term.slice(1)}` : `\n                + ${term}`;
    }).join('');
}

// The lets a function body reads: the point's neighbors, its position and the
// spacing, only where the body names them.
function pointLets(body, index, positionFunction) {
    const lines = [`let here  = ${index}(level, column, row);`];
    const neighbors = { left: 'column - 1u, row', right: 'column + 1u, row', above: 'column, row - 1u', below: 'column, row + 1u' };
    for (const [name, at] of Object.entries(neighbors)) {
        if (new RegExp(`\\[${name}\\]`).test(body)) lines.push(`let ${name.padEnd(5)} = ${index}(level, ${at});`);
    }
    if (/\bposition\b/.test(body)) lines.push(`let position = ${positionFunction}(level, column, row);`);
    if (/\bspacing\b/.test(body)) lines.push('let spacing  = grid.spacing[level];');
    return lines.map((line) => `\n            ${line}`).join('');
}

// The equation at one point:
//
//     0 = -(q - qOld) / dt + theta (terms new) + (1 - theta) (terms old) + f
//
// relaxed by q = q - residual / diagonal. The operator N(q) is minus the terms.
// A term reading the pressure is added whole at the new level, since the
// pressure has no old level. The pressure row has no diagonal, so no relax_:
// system.js steps it from its residual.
function makeEquationCode(equation, arrayNames) {
    const field = equation.field;
    const index = indexFunctionAt(equation.location);
    const positionFunction = positionFunctionAt(equation.location);
    const where = ['cell centers', 'x-faces', 'y-faces'][equation.location];
    const q = arrayNames.value;
    const qOld = arrayNames.history || arrayNames.value;
    const rightHandSide = arrayNames.rightHandSide;

    const unsteady = equation.terms.some((term) => term.term === 'timeDerivative');
    const spatialTerms = equation.terms.filter((term) => term.term !== 'timeDerivative');
    const usesOldLevel = unsteady && equation.theta < 1;
    const readsThePressure = (term) => fieldsReadBy(term).some((name) => !fieldKeepsOldLevel(name));
    const weightedTerms = usesOldLevel ? spatialTerms.filter((term) => !readsThePressure(term)) : spatialTerms;
    const pressureTerms = usesOldLevel ? spatialTerms.filter(readsThePressure) : [];

    const valuesOf = (terms, array, level) => sumOnLines(terms
        .map((term) => TERM_DICTIONARY[term.term].value(array, termAsWgsl(term, equation, level))));
    const diagonalsOf = (terms) => sumOnLines(terms
        .filter((term) => TERM_DICTIONARY[term.term].diagonal)
        .map((term) => TERM_DICTIONARY[term.term].diagonal(q, termAsWgsl(term, equation, 'new'))));

    let sum = 'termsNew';
    const pieces = [];
    if (usesOldLevel) {
        sum = 'change + theta * termsNew + (1.0 - theta) * termsOld';
        pieces.push('-1.0 / timeStep');
        if (diagonalsOf(weightedTerms)) pieces.push(`theta * (${diagonalsOf(weightedTerms)})`);
    } else {
        if (unsteady) {
            sum = 'change + termsNew';
            pieces.push('-1.0 / timeStep');
        }
        if (diagonalsOf(weightedTerms)) pieces.push(diagonalsOf(weightedTerms));
    }
    if (pressureTerms.length) sum += ' + pressureTerms';
    if (diagonalsOf(pressureTerms)) pieces.push(diagonalsOf(pressureTerms));
    const diagonal = pieces.join(' + ') || '0.0';

    const theta = wgslLiteral(equation.theta);
    const timeStep = wgslLiteral(equation.timeStep);
    // language=WGSL
    const timeLets = (usesOldLevel ? `
            let theta    = ${theta};` : '') + (unsteady ? `
            let timeStep = ${timeStep};` : '');

    // language=WGSL
    const termsBody = `${unsteady ? `
            let change = -(${q}[here] - ${qOld}[here]) / timeStep;` : ''}
            let termsNew = ${valuesOf(weightedTerms, q, 'new')};${usesOldLevel ? `
            let termsOld = ${valuesOf(weightedTerms, qOld, 'old')};` : ''}${pressureTerms.length ? `
            let pressureTerms = ${valuesOf(pressureTerms, q, 'new')};` : ''}
            return ${sum};`;
    // language=WGSL
    const diagonalBody = `
            return ${diagonal};`;

    // language=WGSL
    const relaxCode = equation.constraint ? '' : `
        fn diagonal_${field}(level : u32, column : u32, row : u32) -> f32 {${pointLets(diagonalBody, index, positionFunction)}${timeLets}${diagonalBody}
        }

        fn relax_${field}(level : u32, column : u32, row : u32) {
            if (!isSolvedPoint_${field}(level, column, row)) { return; }
            let here = ${index}(level, column, row);
            ${q}[here] = ${q}[here] - residual_${field}(level, column, row) / diagonal_${field}(level, column, row);
        }
`;

    // language=WGSL
    return `
        // ${field}, at ${where}: ${equation.terms.map((term) => term.term).join(' + ')}

        fn terms_${field}(level : u32, column : u32, row : u32) -> f32 {${pointLets(termsBody, index, positionFunction)}${timeLets}${termsBody}
        }

        fn residual_${field}(level : u32, column : u32, row : u32) -> f32 {
            if (!isSolvedPoint_${field}(level, column, row)) { return 0.0; }
            let here = ${index}(level, column, row);
            return ${rightHandSide}[here] + terms_${field}(level, column, row);
        }
${relaxCode}
        fn operator_${field}(level : u32, column : u32, row : u32) -> f32 {
            if (!isSolvedPoint_${field}(level, column, row)) { return 0.0; }
            return -terms_${field}(level, column, row);
        }
    `;
}
