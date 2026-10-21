// verify_equations.js, by Allen Rakhamimov.
// What the panel says a case is solving.
//
// The panel writes its equations from the dictionary: each entry says how its
// term is written, beside the WGSL that computes it. The two can disagree
// without crashing anything, and the panel would then show a plausible equation
// beside a picture made by a different one. Checked here:
//
//   1. Every entry says how it is written.
//   2. Every preset renders: every field and coefficient has a symbol, and
//      nothing comes out holding the word undefined.
//   3. The sign each entry declares is the sign the shader's own arithmetic
//      gives. Each entry is put alone in a row, on a state where its written
//      body is positive, and the row's generated WGSL is run in JavaScript
//      (rowInJavaScript).
//   4. The notation of the bodies survives being set as HTML.
//   5. The Oregonator's rows are Field's equations, from his own constants.
//
// The reaction lines are verify_reactions.js, and the views verify_views.js.
//
// Not checked: the body itself. Nothing here tells a Laplacian from a gradient,
// so the bodies are checked by reading them beside their entries; the sign, the
// half that would reverse what a picture means, is checked here.

// verify.html loads it, then runs the body it registers.
verifyCheck('verify_equations.js', function (process) {
'use strict';

let passCount = 0;
const failures = [];

function check(name, condition, detail) {
    if (condition) { passCount++; return; }
    failures.push(detail ? `${name}  --  ${detail}` : name);
}

// A section that throws is recorded as a failure, and the run still prints its
// verdict.
function section(name, run) {
    try {
        return run();
    } catch (error) {
        failures.push(`${name} raised  --  ${error.message}`);
        return null;
    }
}

function heading(text) {
    console.log('');
    console.log(text);
    console.log('-'.repeat(text.length));
}

// 1. Every entry writes itself

// How a term is written lives with its WGSL in terms.js.
function describedBy(name) {
    return TERM_DICTIONARY[name];
}

function checkEveryEntryDescribes() {
    const names = Object.keys(TERM_DICTIONARY);
    for (const name of names) {
        const entry = describedBy(name);
        check(`${name} declares describe`, typeof entry.describe === 'function',
            'the panel cannot write down a term that does not say how it is written');
    }
    return names.length;
}

// 2. Every preset renders
//
// The symbols come from equationPanel.js, which holds the one table that knows a
// concentration from a temperature. A field or slot missing from it throws, so
// a new one cannot reach the page as a blank.

function checkEveryPresetRenders() {
    const presets = casePresets();
    const distinct = new Map();
    let equationCount = 0;

    for (const preset of presets) {
        let system;
        try {
            system = physicsSystem(preset);
        } catch (error) {
            check(`${preset.id} builds a system`, false, error.message);
            continue;
        }
        // Symbols for this system's own physics: the flux pair is D, B or J
        // by which physics it is.
        const symbols = panelSymbols(system.physics);

        const lines = [];
        for (const equation of system.equations) {
            let text;
            try {
                text = describeText(describeEquation(equation, symbols));
            } catch (error) {
                check(`${preset.id}: ${equation.field} renders`, false, error.message);
                continue;
            }
            equationCount++;
            lines.push(text);

            check(`${preset.id}: ${equation.field} has an equals sign`, text.includes('='), text);
            check(`${preset.id}: ${equation.field} names no undefined`,
                !/undefined|NaN|\[object/.test(text), text);
            // A row whose right-hand side came out empty would render as
            // "= 0", which is true of nothing.
            check(`${preset.id}: ${equation.field} has a body`,
                text.replace(/[^A-Za-z]/g, '').length > 0, text);
        }
        if (!distinct.has(lines.join('\n'))) distinct.set(lines.join('\n'), preset.id);
    }

    // The constraint row is the one the panel rewrites: every fluid case prints
    // it against zero with no leading minus.
    const flow = physicsSystem(casePreset('emptyChannel'));
    const constraint = flow.equations.find((equation) => equation.constraint);
    const written = describeText(describeEquation(constraint, panelSymbols(flow.physics)));
    check('the constraint row is written against zero', written.endsWith('= 0'), written);
    check('the constraint row leads without a sign', !written.startsWith('\u2212'), written);

    return { presets: presets.length, equationCount, distinct };
}

// 3. The sign an entry declares is the sign its arithmetic produces
//
// Each entry is evaluated on a state built so that the body it writes comes out
// positive, so the sign of the result is the sign it should declare. Most
// entries are positive on a flat positive state. An entry carrying a derivative
// gets a state that fixes the derivative's sign: a bowl for a Laplacian, a ramp
// for a gradient and for advection, a spreading velocity for the divergence.

const SITE = { column: 6, row: 5 };

// A plate small enough to be instant and large enough that the site is nowhere
// near a boundary. Walls all round, so nothing here depends on a fill.
function makePlate() {
    const plate = new Plate(MESH_SIZES.length - 1);
    addGeometry(plate, { edges: { left: WALL, right: WALL, top: WALL, bottom: WALL } });
    return plate;
}

// Flat, positive, and identical old and new levels, so that the theta split
// cannot change a sign by itself and every field a cross-field term might read
// is present.
function flatState(plate, value = 0.6) {
    const state = { value: {}, old: {} };
    for (const spec of FIELD_SPEC) {
        const size = [plate.totalCenter, plate.totalXFace, plate.totalYFace][spec.location];
        state.value[spec.name] = new Float64Array(size).fill(value);
        state.old[spec.name] = new Float64Array(size).fill(value);
    }
    return state;
}

// The generated WGSL of one row, run in JavaScript. WGSL's arithmetic,
// comparisons, calls and array reads read the same in JavaScript once the
// declarations lose their types and a whole number loses its u, so this
// evaluates the shader's own text and is not a second copy of the arithmetic.
// The arrays are the plate's, and the Coefficients buffer is its slot values.
function wgslAsJavaScript(text) {
    return text
        .replace(/fn\s+(\w+)\s*\(([^)]*)\)\s*(?:->\s*\w+\s*)?\{/g, (match, name, args) =>
            `function ${name}(${args.split(',').map((arg) => arg.split(':')[0].trim()).filter(Boolean).join(', ')}) {`)
        .replace(/\blet\b/g, 'const')
        .replace(/\bvar\b/g, 'let')
        .replace(/(\d)u\b/g, '$1');
}

function rowInJavaScript(plate, equation) {
    const names = arrayNamesFor(equation.field, equation.location, { history: !equation.constraint });
    const source = [makeDiscretizationFunctionCode({ equations: [equation] }), makeOperatorCode(),
        makeEquationCode(equation, names)].map(wgslAsJavaScript).join('\n');
    const arrays = new Proxy({}, { get: (target, name) => plate[name] });
    const coefficients = new Proxy({}, { get: (target, name) => plate.coefficientValue(name) });
    const position = (location) => (level, column, row) => positionOf(location, column, row, plate.spacing[level]);
    const scope = {
        grid: plate, coefficients, centerState: arrays, centerWorkspace: arrays, xFace: arrays, yFace: arrays,
        indexCenter: (level, column, row) => plate.indexOf(CENTER, level, column, row),
        indexXFace: (level, column, row) => plate.indexOf(XFACE, level, column, row),
        indexYFace: (level, column, row) => plate.indexOf(YFACE, level, column, row),
        positionCenter: position(CENTER), positionXFace: position(XFACE), positionYFace: position(YFACE),
        max: Math.max, min: Math.min, abs: Math.abs, exp: Math.exp, sqrt: Math.sqrt,
        clamp: (value, low, high) => Math.min(Math.max(value, low), high),
        select: (otherwise, then, condition) => (condition ? then : otherwise),
    };
    const build = new Function(...Object.keys(scope), `${source}\nreturn terms_${equation.field};`);
    return build(...Object.values(scope));
}

// Writes a state into the plate's own arrays, new and old levels alike.
function loadState(plate, state) {
    for (const [name, values] of Object.entries(state.value)) if (plate[name]) plate[name].set(values);
    for (const [name, values] of Object.entries(state.old)) {
        const old = arrayNamesOfField(name).history;
        if (old && plate[old.split('.')[1]]) plate[old.split('.')[1]].set(values);
    }
}

// One term on its own, in a steady row, so the row's terms are that term's
// value and nothing else. The theta method is applied once to the sum of the
// terms by the equation code, the same way for every entry, so a steady row is
// enough to see an entry's sign.
function contributionOf(plate, termSpec, location, state) {
    loadState(plate, state);
    const equation = normalizeEquation({ field: termSpec.on, location, steady: true,
        constraint: termSpec.on === 'pressure', terms: [termSpec.params] });
    return rowInJavaScript(plate, equation)(0, SITE.column, SITE.row);
}

// What each entry is given. `on` is the field the equation is for, so the
// location follows from it. Every parameter is positive.
function signCases() {
    const rate = 1.4;
    const halfSaturation = 0.5;
    return [
        { term: 'diffusion', on: 'speciesA', params: { term: 'diffusion', diffusivity: 0.3 },
          state: 'bowl', why: 'a bowl has a positive Laplacian' },
        { term: 'source', on: 'speciesA', params: { term: 'source', value: 2.5 } },
        // A slot stays positive, so a source declares which way it points.
        { term: 'source', on: 'speciesA', params: { term: 'source', value: 2.5, sign: '-' },
          why: 'declared -' },
        { term: 'regionSource', on: 'speciesA',
          params: { term: 'regionSource', rate, target: 3.0 },
          why: 'the target is above the state, so the feed adds' },
        { term: 'secondOrderSink', on: 'speciesA', params: { term: 'secondOrderSink', rate } },
        { term: 'firstOrderSink', on: 'speciesA', params: { term: 'firstOrderSink', rate } },
        { term: 'reactionSink', on: 'speciesA',
          params: { term: 'reactionSink', rate, partners: ['speciesB'] } },
        { term: 'reactionSource', on: 'speciesC',
          params: { term: 'reactionSource', rate, reactants: ['speciesA', 'speciesB'] } },
        { term: 'saturatingSink', on: 'speciesA',
          params: { term: 'saturatingSink', rate, halfSaturation, partner: 'speciesB' } },
        { term: 'saturatingSource', on: 'speciesC',
          params: { term: 'saturatingSource', rate, halfSaturation,
                    substrate: 'speciesA', partner: 'speciesB' } },
        { term: 'advection', on: 'speciesA',
          params: { term: 'advection', xField: 'xVelocity', yField: 'yVelocity',
                    boundedness: 'hybrid', diffusivity: 0.02 },
          state: 'rampedScalar', why: 'transported at +1 up a rising ramp' },
        { term: 'gradientOf', on: 'xVelocity',
          params: { term: 'gradientOf', field: 'pressure', component: 'x' },
          state: 'rampedPressure', why: 'pressure rising in x' },
        // Both declarable signs, on a face row, with the partner above its
        // reference so the written body is positive. The face row is the point:
        // the partner is averaged across two centers to reach it.
        { term: 'proportionalSource', on: 'yVelocity',
          params: { term: 'proportionalSource', field: 'temperature', coefficient: 0.8,
                    reference: 0.2, sign: '+' },
          why: 'the partner is above its reference; declared +' },
        { term: 'proportionalSource', on: 'yVelocity',
          params: { term: 'proportionalSource', field: 'temperature', coefficient: 0.8,
                    reference: 0.2, sign: '-' },
          why: 'the same, declared -' },
        { term: 'divergenceOf', on: 'pressure',
          params: { term: 'divergenceOf', xField: 'xVelocity', yField: 'yVelocity' },
          state: 'spreading', why: 'a velocity rising in x has positive divergence' },
        // A face partner averaged to a center row: the induction equation's
        // source, the velocity carrying the applied field.
        { term: 'proportionalSource', on: 'potential', physics: 'mhd',
          params: { term: 'proportionalSource', field: 'yVelocity', coefficient: 0.8,
                    reference: 0, sign: '-' },
          why: 'a face partner averaged to the center; declared -' },
        // The bowl's Laplacian is 4 and its slope in x is positive at the
        // site, so the written body is positive; the applied field runs along
        // x and adds nothing to the x slope.
        { term: 'lorentzForce', on: 'xVelocity', physics: 'mhd',
          params: { term: 'lorentzForce', field: 'potential', component: 'x',
                    applied: 0.5, along: 'x' },
          state: 'bowlPotential', why: 'a bowl in a: positive Laplacian, rising in x' },
    ];
}

// The states that fix a derivative's sign.
function buildState(plate, kind) {
    const state = flatState(plate);
    if (kind === 'bowl' || kind === 'bowlPotential') {
        // u = x^2 + y^2, whose Laplacian is 4 everywhere.
        const field = kind === 'bowl' ? 'speciesA' : 'potential';
        const n = plate.interior[0];
        const h = plate.spacing[0];
        for (let row = 0; row <= n + 1; row++) {
            for (let column = 0; column <= n + 1; column++) {
                const x = (column - 0.5) * h, y = (row - 0.5) * h;
                const value = 1 + x * x + y * y;
                const p = plate.indexCenter(0, column, row);
                state.value[field][p] = value;
                state.old[field][p] = value;
            }
        }
    }
    if (kind === 'rampedScalar' || kind === 'rampedPressure' || kind === 'spreading') {
        const n = plate.interior[0];
        const h = plate.spacing[0];
        for (let row = 0; row <= n + 1; row++) {
            for (let column = 0; column <= n + 1; column++) {
                const centerP = plate.indexCenter(0, column, row);
                const ramp = 1 + (column - 0.5) * h;
                if (kind === 'rampedScalar') {
                    state.value.speciesA[centerP] = ramp;
                    state.old.speciesA[centerP] = ramp;
                }
                if (kind === 'rampedPressure') {
                    state.value.pressure[centerP] = ramp;
                    state.old.pressure[centerP] = ramp;
                }
            }
        }
        // Transport at +1 in x and nothing in y, except where the point is the
        // divergence itself, which needs a velocity that grows.
        const lastX = plate.interiorLastX(XFACE, 0);
        const lastY = plate.interiorLastY(XFACE, 0);
        for (let row = 0; row <= lastY + 1; row++) {
            for (let faceColumn = 0; faceColumn <= lastX + 1; faceColumn++) {
                const p = plate.indexXFace(0, faceColumn, row);
                const value = (kind === 'spreading') ? (faceColumn - 1) * plate.spacing[0] : 1;
                state.value.xVelocity[p] = value;
                state.old.xVelocity[p] = value;
            }
        }
        state.value.yVelocity.fill(0);
        state.old.yVelocity.fill(0);
    }
    return state;
}

const SIGN_LOCATION = {
    xVelocity: XFACE, yVelocity: YFACE, potential: CENTER,
};

function checkDeclaredSigns() {
    const plate = makePlate();
    // The sign cases name fields that are written the same in every physics,
    // except the few that declare the physics their field is named in.
    const rows = [];

    for (const entry of signCases()) {
        const symbols = panelSymbols(entry.physics || 'flow');
        const location = SIGN_LOCATION[entry.on] !== undefined
            ? SIGN_LOCATION[entry.on] : CENTER;
        const written = describedBy(entry.term).describe({
            params: entry.params,
            symbol: symbols.field(entry.on),
            fieldSymbol: symbols.field,
            vector: symbols.vector,
            coefficient: (param, kind) => symbols.coefficient(param, kind, entry.on),
            product: (names) => describeProduct(names, symbols.field),
            rate: (param) => symbols.coefficient(param, 'rate', entry.on),
            value: (param) => String(param),
        });

        const state = buildState(plate, entry.state || 'flat');
        const value = contributionOf(plate, entry, location, state);
        const got = value > 0 ? '+' : (value < 0 ? '-' : '0');
        check(`${entry.term}: declared ${written.sign}, the shader's arithmetic ${got}`,
            got === written.sign, `${written.body} evaluated to ${value.toExponential(3)}`);
        rows.push({ term: entry.term, sign: written.sign, body: written.body, value, why: entry.why || '' });
    }
    return rows;
}

// 4. The notation survives being set

function checkNotation() {
    const markup = panelMarkup;
    check('a subscript becomes a subscript', markup('C_A') === 'C<sub>A</sub>', markup('C_A'));
    check('a superscript becomes a superscript', markup('C_B^2') === 'C<sub>B</sub><sup>2</sup>',
        markup('C_B^2'));
    check('a vector comes out bold', markup('**u**') === '<b>u</b>', markup('**u**'));
    // Escaping runs before the three rules, so an angle bracket in a symbol
    // cannot reach the page as markup.
    check('markup is escaped first', markup('<script>') === '&lt;script&gt;', markup('<script>'));

    // Every body of every preset, set as HTML: what must not appear is an
    // unbalanced marker, which would mean the notation had met a symbol it could
    // not carry.
    let bodies = 0;
    for (const preset of casePresets()) {
        const system = physicsSystem(preset);
        const symbols = panelSymbols(system.physics);
        for (const equation of system.equations) {
            // A symbol that will not resolve throws, and the section above has
            // already recorded it. Catching it here keeps the run going to its
            // verdict.
            let written;
            try {
                written = describeEquation(equation, symbols);
            } catch (error) {
                continue;
            }
            for (const term of written.right) {
                bodies++;
                const html = markup(term.body);
                check(`${preset.id}/${equation.field}: no stray marker`,
                    !/[_^*]/.test(html), html);
            }
        }
    }
    return bodies;
}

// The Oregonator is Field's equations
//
// The case writes the mechanism as tagged terms with its constants converted to
// mM. This writes Field's unscaled equations (Scholarpedia 2(5):1386) from his
// own constants in M, converts them here, and checks each species' row of the
// generated shader against them at several states. A constant in the wrong
// units, a term on the wrong species, or a quotient slot built wrong on the
// host gives a plausible picture and fails here. k_e and f are the case's own
// choices and are read from the preset; everything else is Field's.
function checkOregonator() {
    const cases = casePresets().filter((preset) => preset.system.physics === 'oregonator');
    check('some case runs the Oregonator', cases.length > 0, `${cases.length} cases`);
    const mM = 1e-3;                                                     // M per mM
    const bromate = 0.06, k1 = 1.28, k2 = 2.4e6, k3 = 33.6, k4 = 2400;   // M, per M per s
    const fields = ['speciesA', 'speciesB', 'speciesC'];
    for (const preset of cases) {
        appSelectPreset(preset.id);
        const system = physicsSystem(preset);
        const plate = makePlate();
        plate.setCoefficients(appCoefficientValues());
        const ke = preset.coefficients.recoveryRate, f = preset.coefficients.stoichiometricFactor;
        const R = (X, Y, Z) => [
            k1 * bromate * Y - k2 * mM * X * Y + k3 * bromate * X - 2 * k4 * mM * X * X,
            -k1 * bromate * Y - k2 * mM * X * Y + 0.5 * f * ke * Z,
            2 * k3 * bromate * X - ke * Z,
        ];
        let worst = 0;
        for (const [now, before] of [
            [[0.3, 1e-4, 2.0], [0.25, 2e-4, 1.8]],
            [[7.5e-5, 1.5e-3, 3e-3], [7.0e-5, 1.4e-3, 3.1e-3]],
            [[0.01, 0.8, 0.5], [0.02, 0.7, 0.6]],
        ]) {
            fields.forEach((field, k) => {
                plate[field].fill(now[k]);
                plate[`${field}Old`].fill(before[k]);
            });
            const rNew = R(...now), rOld = R(...before);
            for (const equation of system.equations) {
                const k = fields.indexOf(equation.field);
                const theta = equation.theta, dt = equation.timeStep;
                // The operator N is minus the row's terms.
                const want = (now[k] - before[k]) / dt - theta * rNew[k] - (1 - theta) * rOld[k];
                const got = -rowInJavaScript(plate, equation)(0, SITE.column, SITE.row);
                // The plate holds single precision, which sets the floor; a wrong
                // constant is off by order one.
                const error = Math.abs(got - want) / Math.max(Math.abs(want), 1e-30);
                worst = Math.max(worst, error);
                check(`${preset.id}: ${equation.field} is Field's equation at X ${now[0]}`, error < 1e-4,
                    `${got} against ${want}, relative ${error.toExponential(2)}`);
            }
        }
        console.log(`  ${preset.id}: three species at three states, worst relative ${worst.toExponential(2)}`);
    }
}

function main() {
    console.log('verify_equations.js: the panel writes the case\'s own equations');

    heading('EVERY ENTRY WRITES ITSELF');
    const entryCount = section('every entry writes itself', checkEveryEntryDescribes);
    console.log(`  ${entryCount} dictionary entries, each with a describe beside its`);
    console.log('  value and its diagonal.');

    heading('EVERY CASE RENDERS');
    const rendered = section('every case renders', checkEveryPresetRenders);
    if (rendered) {
        console.log(`  ${rendered.presets} presets, ${rendered.equationCount} equations rendered, `
            + `${rendered.distinct.size} distinct systems among them.`);
        console.log('');
        for (const [lines, id] of rendered.distinct) {
            console.log(`  ${id}`);
            for (const line of lines.split('\n')) console.log(`      ${line}`);
            console.log('');
        }
    }

    heading('THE DECLARED SIGN IS THE ARITHMETIC SIGN');
    console.log('  entry                      sign  contribution   written');
    for (const row of section('declared signs', checkDeclaredSigns) || []) {
        console.log(`  ${row.term.padEnd(24)}  ${row.sign === '-' ? ' -' : ' +'}  `
            + `${row.value.toExponential(2).padStart(12)}   ${row.body.replace(/\*\*/g, '')}`
            + (row.why ? `   (${row.why})` : ''));
    }

    heading('THE NOTATION');
    const bodies = section('the notation', checkNotation);
    console.log(`  ${bodies} term bodies set as HTML, none leaving a marker behind.`);

    heading("EVERY OREGONATOR CASE SOLVES FIELD'S EQUATIONS");
    section('the Oregonator', checkOregonator);

    heading('RESULT');
    console.log(`  ${passCount} checks passed.`);
    if (failures.length) {
        console.log(`  ${failures.length} FAILED:`);
        for (const f of failures.slice(0, 40)) console.log(`    ${f}`);
        if (failures.length > 40) console.log(`    ... and ${failures.length - 40} more`);
    }
    console.log('');
    console.log('  The sign of every entry is checked here; the body is not. Nothing here');
    console.log('  tells a Laplacian from a gradient, so the bodies are checked by reading');
    console.log('  them beside their entries.');

    process.exitCode = failures.length === 0 ? 0 : 1;
}

main();
});
