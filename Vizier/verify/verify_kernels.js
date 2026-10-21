// verify_kernels.js, by Allen Rakhamimov.
// The compute entry points generated from a system.
//
// The entry points the frame loop dispatches are generated from the system, not
// written per field. Checked here:
//
//   1. The set follows the system: adding a field adds its whole kernel set
//      with no edit anywhere else, and removing one removes it.
//   2. Every kernel calls only what the emitters define.
//   3. Every array a kernel names is allocated.
//   4. Each kernel opens with the bounds test for its own location.
//   5. A kernel that covers the ghost ring is dispatched over the whole array.
//   6. A system with no flow generates no speed scan, and dispatches none.
//   7. A term that depends on its row's location is emitted for that location.
//   8. Reaction terms put the right part in the diagonal.
//   9. A declared time derivative is refused, since one is inserted.
//   10. The constraint row's step reads all four faces around its cell.

// verify.html loads it, then runs the body it registers.
verifyCheck('verify_kernels.js', function (process) {
'use strict';

const WORKGROUP = 8;

let passCount = 0;
const failures = [];

function check(name, condition, detail) {
    if (condition) { passCount++; return; }
    failures.push(detail ? `${name}  --  ${detail}` : name);
}

function heading(text) {
    console.log('');
    console.log(text);
    console.log('-'.repeat(text.length));
}

// The system under test
//
// Array names straight from fields.js, so the check uses the app's naming rule.
const NAMES = (equation) => arrayNamesFor(equation.field, equation.location,
    { history: !equation.constraint });

function momentumRow(field, location, component, extra = []) {
    return {
        field, location, role: ROLE_VELOCITY, steady: true,
        terms: [
            { term: 'diffusion', diffusivity: 0.05 },
            { term: 'advection', xField: 'xVelocity', yField: 'yVelocity', boundedness: 'hybrid', diffusivity: 0.05 },
            { term: 'gradientOf', field: 'pressure', component },
            ...extra,
        ],
    };
}

function constraintRow() {
    return {
        field: 'pressure', location: CENTER, role: ROLE_PRESSURE,
        constraint: true, steady: true,
        terms: [{ term: 'divergenceOf', xField: 'xVelocity', yField: 'yVelocity' }],
    };
}

function buildSystem(extraEquations = []) {
    return normalizeSystem({
        name: 'flow',
        equations: [
            momentumRow('xVelocity', XFACE, 'x'),
            momentumRow('yVelocity', YFACE, 'y'),
            constraintRow(),
            ...extraEquations,
        ],
        relaxation: { scheme: SCHUR_RELAXATION, c: 0.5 },
    });
}

function speciesRow(field) {
    return {
        field, location: CENTER, role: ROLE_SCALAR, steady: true,
        terms: [
            { term: 'diffusion', diffusivity: 0.01 },
            { term: 'advection', xField: 'xVelocity', yField: 'yVelocity', boundedness: 'hybrid', diffusivity: 0.05 },
            { term: 'firstOrderSink', rate: 2.0 },
        ],
    };
}

function entryPointsOf(code) {
    const names = new Set();
    for (const m of code.matchAll(/@compute[\s\S]{0,60}?fn\s+([A-Za-z_]\w*)/g)) names.add(m[1]);
    return names;
}

// 1. The set follows the system
const PER_FIELD_MOMENTUM = ['fill', 'relaxRed', 'relaxBlack', 'residualInto',
    'restrictValue', 'restrictResidual', 'prolongChange', 'coarseRightHandSide', 'change', 'snapshot', 'scanHealth'];
const PER_FIELD_CONSTRAINT = ['fill', 'relaxAll', 'residualInto',
    'restrictValue', 'restrictResidual', 'prolongChange', 'coarseRightHandSide', 'change', 'snapshot', 'scanHealth'];

function checkSetFollowsSpec() {
    heading('THE ENTRY POINT SET FOLLOWS THE SYSTEM');

    const base = buildSystem();
    const baseCode = makeKernelCode(base, NAMES, WORKGROUP, 5);
    const baseEntries = entryPointsOf(baseCode);

    for (const equation of base.equations) {
        const expected = equation.constraint ? PER_FIELD_CONSTRAINT : PER_FIELD_MOMENTUM;
        for (const kind of expected) {
            check(`${kind}_${equation.field} is generated`, baseEntries.has(`${kind}_${equation.field}`));
        }
    }

    // The constraint row is not colored: it reads no pressure at a neighbor, so
    // a second color would compute the same thing.
    check('the constraint row is not colored',
        !baseEntries.has('relaxRed_pressure') && !baseEntries.has('relaxBlack_pressure'),
        'a row with no self-coupling does not need two dispatches');
    check('momentum rows are colored',
        baseEntries.has('relaxRed_xVelocity') && baseEntries.has('relaxBlack_xVelocity'));

    // Adding a species adds its own kernels and nothing else.
    const withSpecies = buildSystem([speciesRow('speciesA')]);
    const grown = entryPointsOf(makeKernelCode(withSpecies, NAMES, WORKGROUP, 5));
    const added = [...grown].filter((n) => !baseEntries.has(n)).sort();
    const expectedAdded = PER_FIELD_MOMENTUM.map((k) => `${k}_speciesA`).sort();
    check('adding one species adds exactly its own kernels and nothing else',
        added.join(',') === expectedAdded.join(','),
        `added ${added.join(', ')}`);

    // Two species do not collide: the second adds its own full set and touches
    // nothing of the first's.
    const withTwo = entryPointsOf(makeKernelCode(
        buildSystem([speciesRow('speciesA'), speciesRow('speciesB')]), NAMES, WORKGROUP, 5));
    const addedSecond = [...withTwo].filter((n) => !grown.has(n)).sort();
    check('a second species adds exactly its own kernels',
        addedSecond.join(',') === PER_FIELD_MOMENTUM.map((k) => `${k}_speciesB`).sort().join(','),
        `added ${addedSecond.join(', ')}`);

    // An unsteady field also has its previous time level shifted; a steady one
    // does not, since FIELD_SPEC allocates it no history array.
    const unsteadyEntries = entryPointsOf(makeKernelCode(normalizeSystem({
        name: 'unsteady',
        equations: [
            { field: 'xVelocity', location: XFACE, role: ROLE_VELOCITY, timeStep: 0.01,
              terms: [{ term: 'diffusion', diffusivity: 0.05 },
                      { term: 'gradientOf', field: 'pressure', component: 'x' }] },
            constraintRow(),
        ],
        relaxation: { scheme: SCHUR_RELAXATION, c: 0.5 },
    }), NAMES, WORKGROUP, 5));
    check('an unsteady field gets a history shift',
        unsteadyEntries.has('shiftHistory_xVelocity'));
    check('a steady field does not',
        !baseEntries.has('shiftHistory_xVelocity') && !baseEntries.has('shiftHistory_pressure'));

    // The coarse operator carries (u - uOld)/dt as the fine one does, so the
    // previous time level has to reach the coarse levels too. A coarse level
    // whose uOld was never written corrects against a different equation, a
    // little wrong every cycle, and nothing here runs a cycle to see it.
    check('an unsteady field restricts its history to the coarse levels',
        unsteadyEntries.has('restrictHistory_xVelocity'),
        'the coarse time derivative would read a history nothing ever wrote');
    check('a steady field does not restrict a history it does not have',
        !baseEntries.has('restrictHistory_xVelocity') &&
        !baseEntries.has('restrictHistory_pressure'));

    // One level setter per level, since the host cannot write the level while
    // the compute pass is being built.
    for (let level = 0; level < 5; level++) {
        check(`setLevel${level} is generated`, baseEntries.has(`setLevel${level}`));
    }
    check('there is no host-written level setter', !baseEntries.has('setLevel'));

    console.log(`  ${baseEntries.size} entry points for three fields, ${grown.size} with a species added.`);
    return base;
}

// 2. Every call resolves
function assembleAppSource(system) {
    const parts = [makeStructCode(plateFor()), makeBindingCode('bgra8unorm'), makeIndexCode()];
    parts.push(makeTransferHelperCode());
    parts.push(makeBoundaryHelperCode());
    parts.push(makeOperatorCode());
    parts.push(makeDiscretizationFunctionCode(system));

    const table = defaultBoundaryTable();
    for (const equation of system.equations) {
        const names = NAMES(equation);
        parts.push(makeBoundaryCode(equation.field, names.value, equation.location, equation.role, table));
        parts.push(makeEquationCode(equation, names));
        parts.push(makeFasCode(equation, names));
        parts.push(makeRestrictCode(`${equation.field}Value`, equation.location, names.value));
        parts.push(makeRestrictCode(`${equation.field}Residual`, equation.location, names.residual));
        parts.push(makeProlongCode(`${equation.field}Change`, equation.location, names.restricted));
    }
    parts.push(makeSystemCode(system, NAMES));
    parts.push(makeKernelCode(system, NAMES, WORKGROUP, 5));
    return parts.join('\n');
}

let cachedPlate = null;
function plateFor() {
    if (!cachedPlate) {
        cachedPlate = new Plate(5);
        addGeometry(cachedPlate, { edges: { left: INLET, right: OUTLET, top: WALL, bottom: SYMMETRY } });
    }
    return cachedPlate;
}

const WGSL_BUILTINS = new Set([
    'if', 'for', 'while', 'switch', 'return', 'let', 'var', 'fn', 'struct', 'case',
    'vec2f', 'vec3f', 'vec4f', 'vec2u', 'vec3u', 'vec4u', 'vec2', 'vec3', 'vec4',
    'f32', 'u32', 'i32', 'bool', 'array', 'atomic', 'bitcast',
    'sin', 'cos', 'tan', 'abs', 'max', 'min', 'sqrt', 'exp', 'log', 'pow', 'floor', 'ceil',
    'clamp', 'select', 'mix', 'sign', 'fract', 'dot', 'length', 'normalize', 'step',
    'atomicMax', 'atomicLoad', 'atomicStore', 'atomicAdd',
    'textureStore', 'textureLoad', 'textureDimensions',
    'workgroup_size', 'compute', 'builtin', 'group', 'binding', 'storage',
]);

function checkEveryCallResolves(system) {
    heading('EVERY GENERATED KERNEL CALLS SOMETHING THAT EXISTS');

    const source = assembleAppSource(system);
    const defined = new Set();
    for (const m of source.matchAll(/\bfn\s+([A-Za-z_]\w*)\s*\(/g)) defined.add(m[1]);
    // A struct declaration defines its constructor, Layout(...).
    for (const m of source.matchAll(/\bstruct\s+([A-Za-z_]\w*)/g)) defined.add(m[1]);

    const stripped = source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const unresolved = new Set();
    for (const m of stripped.matchAll(/([A-Za-z_]\w*)\s*\(/g)) {
        if (!defined.has(m[1]) && !WGSL_BUILTINS.has(m[1])) unresolved.add(m[1]);
    }
    check('every function called in the assembled source is defined',
        unresolved.size === 0, `unresolved: ${[...unresolved].join(', ')}`);

    for (const [open, close] of [['{', '}'], ['(', ')'], ['[', ']']]) {
        let depth = 0;
        for (const ch of source) { if (ch === open) depth++; else if (ch === close) depth--; }
        check(`assembled source balances ${open} ${close}`, depth === 0, `final depth ${depth}`);
    }

    check('no unsubstituted placeholder survived',
        !stripped.includes('undefined') && !stripped.includes('NaN') && !stripped.includes('[object'));

    console.log(`  ${source.split('\n').length} lines assembled, ${defined.size} functions defined.`);
}

// 3. Every array a kernel names is allocated
//
// The emitters take array names as strings, so a kernel could name
// centerWorkspace.speciesAOperator with nothing noticing that FIELD_SPEC
// allocates no such array. On the GPU that is a compile error at best and a
// read of the wrong field at worst.

function checkArraysExist(system) {
    heading('EVERY ARRAY A KERNEL NAMES IS ALLOCATED');

    const plate = plateFor();
    const allocated = new Map();
    for (const groupSpec of BUFFER_GROUPS) {
        for (const array of plate.arraysInGroup(groupSpec)) {
            if (!allocated.has(groupSpec.name)) allocated.set(groupSpec.name, new Set());
            allocated.get(groupSpec.name).add(array.name);
        }
    }

    const code = makeKernelCode(system, NAMES, WORKGROUP, 5);
    const missing = [];
    for (const m of code.matchAll(/\b(centerState|centerWorkspace|xFace|yFace)\.([A-Za-z_]\w*)/g)) {
        const [, groupName, arrayName] = m;
        if (!allocated.get(groupName) || !allocated.get(groupName).has(arrayName)) {
            missing.push(`${groupName}.${arrayName}`);
        }
    }
    check('every array referenced by a generated kernel exists in FIELD_SPEC',
        missing.length === 0, `missing: ${[...new Set(missing)].join(', ')}`);

    const counts = [...allocated].map(([name, set]) => `${name} ${set.size}`).join(', ');
    console.log(`  arrays allocated: ${counts}`);
}

// 4. Dispatch bounds match the location
function checkBounds(system) {
    heading('DISPATCH BOUNDS MATCH EACH FIELD\'S LOCATION');

    const code = makeKernelCode(system, NAMES, WORKGROUP, 5);
    const index = makeIndexCode();
    // Every kernel opens with the named test for its own location, and the test
    // is defined once, in the index code. Both halves are checked: the kernel
    // calls the right test, and the test holds the right extent. N cells have N
    // + 1 faces, so a face's own normal axis runs one further.
    const names = { [CENTER]: 'Center', [XFACE]: 'XFace', [YFACE]: 'YFace' };
    const extents = {
        [CENTER]: 'column <= grid.interior[level] && row >= 1u && row <= grid.interior[level]',
        [XFACE]: 'column <= grid.interior[level] + 1u && row >= 1u && row <= grid.interior[level]',
        [YFACE]: 'column <= grid.interior[level] && row >= 1u && row <= grid.interior[level] + 1u',
    };
    const definition = (name) => {
        const start = index.indexOf(`fn ${name}(`);
        return start < 0 ? '' : index.slice(start, index.indexOf('\n        }', start));
    };

    for (const equation of system.equations) {
        const name = names[equation.location];
        const relaxName = equation.constraint ? `relaxAll_${equation.field}` : `relaxRed_${equation.field}`;
        const start = code.indexOf(`fn ${relaxName}(`);
        const body = code.slice(start, code.indexOf('\n        }', start));
        check(`${equation.field} guards its own extent`,
            body.includes(`!isInterior${name}(level, column, row)`)
                && definition(`isInterior${name}`).includes(extents[equation.location]),
            `expected a call to isInterior${name}, defined with "${extents[equation.location]}"`);

        // The fill covers the ghost margin, so it is dispatched over the whole
        // array and does not carry the interior test.
        const fillStart = code.indexOf(`fn fill_${equation.field}(`);
        const fill = code.slice(fillStart, code.indexOf('\n        }', fillStart));
        check(`${equation.field} fill covers the ghost margin`,
            fill.includes(`!isStored${name}(level, column, row)`) && !fill.includes('isInterior')
                && definition(`isStored${name}`).includes(`column < grid.width${name}[level] && row < grid.height${name}[level]`),
            'a fill guarded by the interior extent leaves the margin unwritten');
    }

    console.log('  Three locations, three guards, taken from the field\'s own index space.');
}

// 5. Dispatch extent is a property of the kernel
//
// A margin kernel indexes straight from the invocation id and expects to be
// launched over the whole array; an interior kernel tests against the interior
// extent. Launched at the interior extent, a margin kernel leaves the outermost
// rows and columns unwritten, with no error and no NaN: the band stops updating
// and reads as a physical bias. The emitter declares which kernels are margin
// kernels and the frame loop reads the declaration; this checks the two agree.

function checkMarginKernels(system) {
    heading('MARGIN KERNELS ARE DECLARED, NOT GUESSED');

    const code = makeKernelCode(system, NAMES, WORKGROUP, 5);
    const declared = new Set(marginKernels());

    const bodies = new Map();
    for (const m of code.matchAll(/fn\s+([A-Za-z_]\w*)\s*\(@builtin[\s\S]*?\n        \}/g)) {
        bodies.set(m[1], m[0]);
    }

    let margin = 0;
    for (const [name, body] of bodies) {
        const kind = name.replace(/_.*$/, '');
        // A margin kernel bounds itself by the array width; an interior kernel
        // by the interior extent. The two are never both present.
        const looksMargin = /!isStored\w+\(/.test(body) && !/isInterior/.test(body);
        const looksInterior = /!isInterior\w+\(/.test(body);
        if (!looksMargin && !looksInterior) continue;

        check(`${name} is dispatched at the extent its body assumes`,
            looksMargin === declared.has(kind),
            looksMargin
                ? `${kind} spans the margin but is not in marginKernels()`
                : `${kind} is declared a margin kernel but guards against the interior extent`);
        if (looksMargin) margin++;
    }

    check('at least the fill and the history shift span the margin', margin >= 2,
        `${margin} margin kernels found`);

    console.log(`  ${bodies.size} entry points, ${margin} spanning the ghost margin: ` +
        `${[...declared].join(', ')}`);
}

// 6. The speed scan
//
// A flow system measures its largest speed on the GPU for the panel; a system
// with no flow generates no scan, and the frame loop asks the same question
// (monitorsMeasureSpeed) before dispatching one.

function checkSpeedScan() {
    heading('SPEED SCAN');
    const flow = makeKernelCode(buildSystem(), NAMES, WORKGROUP, 5);
    check('a flow system measures its speed rather than assuming it',
        flow.includes('fn scanVelocityMax') && flow.includes('atomicMax(&controls.velocityMaxBits')
            && flow.includes('fn recordVelocityMax'));
    const scalar = makeKernelCode(normalizeSystem({ name: 'scalar',
        equations: [speciesRow('speciesA')] }), NAMES, WORKGROUP, 5);
    check('a system with no flow generates no scan',
        !scalar.includes('velocityMaxBits') && !monitorsMeasureSpeed(normalizeSystem({ name: 'scalar',
            equations: [speciesRow('speciesA')] })));
}

// 7. Location-aware emission
//
// A term that branches on its row's location gets the location from the emit
// context, and advection's default branch is the center's. A face row given the
// center branch is still valid WGSL, at the wrong points, so the emitted text
// is checked directly.

function checkLocationAwareEmission() {
    heading('EMITTED TERMS SEE THE FIELD\'S LOCATION');

    const expected = [
        { name: 'x-face', location: XFACE, uses: 'yFaceToXFace', avoids: 'yFaceToCenter' },
        { name: 'y-face', location: YFACE, uses: 'xFaceToYFace', avoids: 'xFaceToCenter' },
        { name: 'center', location: CENTER, uses: 'xFaceToCenter', avoids: 'yFaceToXFace' },
    ];

    for (const spot of expected) {
        const equation = normalizeEquation({
            field: 'probe', location: spot.location, role: ROLE_VELOCITY, steady: true,
            terms: [{ term: 'advection', xField: 'xVelocity', yField: 'yVelocity', boundedness: 'hybrid', diffusivity: 0.05 }],
        });
        const names = arrayNamesFor('xVelocity', spot.location, { history: true });
        // The whole equation function: advection binds its transporting
        // velocity once in the prelude and refers to it by name afterwards.
        const emitted = makeEquationCode(equation, names);

        check(`advection at a ${spot.name} transports through ${spot.uses}`,
            emitted.includes(`${spot.uses}(`), emitted.trim().slice(0, 90));
        check(`advection at a ${spot.name} does not use ${spot.avoids}`,
            !emitted.includes(`${spot.avoids}(`),
            'the emit context is missing the location and the center branch is winning');
    }

    console.log('  Three locations, three different transporting interpolations.');
}

// 8. Reactions across fields
function checkReactionTerms() {
    heading('A REACTION SPANS THREE EQUATIONS');

    // The sink is linear in its own field once the partner is held fixed, so
    // its diagonal is the rate times the partner, never zero for a positive
    // partner. The source reads neither its own field nor its neighbors, so it
    // adds nothing to the diagonal.
    const diagonalOf = (code, field) => {
        const start = code.indexOf(`fn diagonal_${field}`);
        return start < 0 ? '' : code.slice(start, code.indexOf('}', start));
    };
    const termsOf = (code, field) => {
        const start = code.indexOf(`fn terms_${field}`);
        return code.slice(start, code.indexOf('}', start));
    };
    const sinkNames = arrayNamesOfField('speciesA');
    const sink = makeEquationCode(normalizeEquation({
        field: 'speciesA', location: CENTER, role: ROLE_SCALAR, timeStep: 0.01, theta: 0.55,
        terms: [{ term: 'reactionSink', rate: 2, partners: ['speciesB'] }],
    }), sinkNames);
    const sinkDiagonal = diagonalOf(sink, 'speciesA');
    check('the reaction sink puts its rate times its partner on the diagonal',
        sinkDiagonal.includes('2.0 * centerState.speciesB[here]'), sinkDiagonal.trim().split('\n').pop());

    const sourceNames = arrayNamesOfField('speciesC');
    const source = makeEquationCode(normalizeEquation({
        field: 'speciesC', location: CENTER, role: ROLE_SCALAR, timeStep: 0.01, theta: 0.55,
        terms: [{ term: 'reactionSource', rate: 2, reactants: ['speciesA', 'speciesB'] }],
    }), sourceNames);
    const sourceDiagonal = diagonalOf(source, 'speciesC');
    const sourceTerms = termsOf(source, 'speciesC');
    check('the reaction source puts nothing on the diagonal',
        sourceDiagonal.includes('return -1.0 / timeStep;'), sourceDiagonal.trim().split('\n').pop());
    check('the reaction source reads both reactants',
        sourceTerms.includes('centerState.speciesA[here] * centerState.speciesB[here]'), sourceTerms.trim());

    // A field name that FIELD_SPEC does not declare has no arrays, and emitting
    // a reference to one would be a compile error at best.
    let threw = false;
    try { arrayNamesOfField('speciesQ'); } catch (error) { threw = true; }
    check('a reaction naming an undeclared field is rejected', threw);

    console.log('  Sink on the diagonal, source off it, both resolved through FIELD_SPEC.');
}

// 9. One time derivative
function checkTimeDerivativeOwnership() {
    heading('THE TIME DERIVATIVE HAS ONE OWNER');

    let threw = false;
    try {
        normalizeEquation({
            field: 'temperature', location: CENTER, role: ROLE_SCALAR, timeStep: 0.01,
            terms: [{ term: 'timeDerivative' }, { term: 'diffusion', diffusivity: 1 }],
        });
    } catch (error) { threw = true; }
    check('a spec that declares timeDerivative is rejected', threw,
        'it is inserted for every unsteady field, so declaring it double counts 1/dt in N');

    const inserted = normalizeEquation({
        field: 'temperature', location: CENTER, role: ROLE_SCALAR, timeStep: 0.01,
        terms: [{ term: 'diffusion', diffusivity: 1 }],
    });
    check('an unsteady field gets exactly one time derivative',
        inserted.terms.filter((t) => t.term === 'timeDerivative').length === 1);

    const steady = normalizeEquation({
        field: 'temperature', location: CENTER, role: ROLE_SCALAR, steady: true,
        terms: [{ term: 'diffusion', diffusivity: 1 }],
    });
    check('a steady field gets none',
        steady.terms.every((t) => t.term !== 'timeDerivative'));
}

// 10. The constraint row's step reads all four faces
//
// relaxConstraint_ takes its Schur step per point from the momentum diagonal of
// the four faces around the cell, each where it is. A step read from fewer
// faces, or from one face twice, still converges on a uniform case; on a
// contrast it diverges.
function checkSchurFaces(system) {
    heading('THE CONSTRAINT STEP READS ALL FOUR FACES');
    const source = assembleAppSource(system);
    const start = source.indexOf('fn relaxConstraint_pressure(');
    check('relaxConstraint_pressure is generated', start >= 0);
    if (start < 0) return;
    const body = source.slice(start, source.indexOf('\n        }', start));
    const faces = ['schurDiagonal_xVelocity(level, column, row)', 'schurDiagonal_xVelocity(level, column + 1u, row)',
        'schurDiagonal_yVelocity(level, column, row)', 'schurDiagonal_yVelocity(level, column, row + 1u)'];
    for (const face of faces) {
        check(`the step reads ${face}`, body.split(face).length === 2, `found ${body.split(face).length - 1} times`);
    }
    for (const field of ['xVelocity', 'yVelocity']) {
        check(`schurDiagonal_${field} is generated`, source.includes(`fn schurDiagonal_${field}(`));
    }
    console.log(`  four faces, each read once, in relaxConstraint_pressure`);
}

// Main
function guarded(name, body) {
    try {
        return body();
    } catch (error) {
        failures.push(`${name} raised: ${error.message}`);
        return undefined;
    }
}

function main() {
    console.log('KERNEL GENERATION');
    console.log('Entry points generated from the system declaration, not written per field.');

    // Every section is guarded, so one that raises is recorded as a failure and
    // the run still reaches its verdict.
    const system = guarded('checkSetFollowsSpec', checkSetFollowsSpec);
    const dependents = [checkEveryCallResolves, checkArraysExist, checkBounds,
                        checkMarginKernels, checkSchurFaces];
    if (system) {
        for (const section of dependents) guarded(section.name, () => section(system));
    } else {
        failures.push(`the system did not build, so ${dependents.length} sections that read it did not run`);
    }
    for (const section of [checkLocationAwareEmission, checkReactionTerms,
                           checkSpeedScan, checkTimeDerivativeOwnership]) {
        guarded(section.name, section);
    }

    heading('RESULT');
    console.log(`${passCount} checks passed.`);
    if (failures.length) {
        console.log(`${failures.length} FAILED:`);
        for (const f of failures) console.log(`  ${f}`);
    } else {
        console.log('All kernel generation checks passed.');
        console.log('');
        console.log('Structure only. No WGSL is executed here, and a kernel that resolves');
        console.log('every name can still compute the wrong thing.');
    }
    process.exitCode = failures.length === 0 ? 0 : 1;
}

main();
});
