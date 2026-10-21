// verify_views.js, by Allen Rakhamimov.
// The views and species a case offers, against the draw shader it generates.
//
// The view bar and the species row offer only what the running system can
// show. Both are read off the generated draw shader, never off the lists that
// generated it: each offered view's arm reads only arrays the case solves, and
// each species button keeps exactly the species its array holds.

// verify.html loads it, then runs the body it registers.
verifyCheck('verify_views.js', function (process) {
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

// The views follow the system
//
// The view bar offers only the views a case can fill, from each record's needs
// in views.js. Checking that list against itself would prove nothing, so this reads
// the shader: for every view offered, the arm the draw kernel takes for it is
// cut out of the generated source, and every solver array the arm reads must
// belong to a field the case solves. A view of an array nothing writes would
// draw a picture that looks like a result.
const VIEW_ARM_READS = [
    [/centerState\.temperature\b/, ['temperature']],
    [/centerState\.pressure\b|DRAW_BASE_PRESSURE/, ['pressure']],
    [/centerState\.divergence\b|DRAW_BASE_DIVERGENCE/, ['pressure']],
    [/xFaceToCenter|drawSampleXVelocity|drawCellVelocity|vorticityAtCenter|drawSampleVorticity/, ['xVelocity']],
    [/yFaceToCenter|drawSampleYVelocity|drawCellVelocity|vorticityAtCenter|drawSampleVorticity/, ['yVelocity']],
    [/drawSampleXFlux/, ['fluxX']],
    [/drawSampleYFlux/, ['fluxY']],
    [/drawCurrentAt|drawSampleCurrent/, ['potential']],
];

// Every solver array an arm names directly, by buffer member or by sampler
// base, whatever the field: the table above covers the helpers that hide an
// array behind a function, and this covers everything else, so a field added
// to FIELD_SPEC is checked here with no edit to the check.
function armArraysRead(arm) {
    const fields = new Set();
    for (const match of arm.matchAll(/\b(?:centerState|xFace|yFace)\.([a-zA-Z]+)\b/g)) fields.add(match[1]);
    for (const match of arm.matchAll(/\bDRAW_BASE_([A-Z_]+)\b/g)) {
        fields.add(match[1].toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase()));
    }
    return [...fields].filter((name) => FIELD_SPEC.some((f) => f.name === name && f.solved));
}

// The draw shader as the page builds it (runtime.js), display scales included.
function drawCodeFor(plate, system) {
    const preset = appActivePreset();
    return makeDrawCode(plate, Object.assign({ workgroup: 8, system }, displaySettings,
        { speciesScale: preset.display.speciesScale, potentialScale: preset.display.potentialScale,
          currentScale: preset.display.currentScale, fluxScale: preset.display.fluxScale,
          fieldLineScale: preset.display.fieldLineScale }));
}

function drawArms(code) {
    const body = code.slice(code.indexOf('fn drawField('));
    const arms = new Map();
    const pieces = body.split(/\n {16}case /).slice(1);
    for (const piece of pieces) {
        const index = Number(piece.match(/^(\d+)u/)[1]);
        arms.set(index, piece);
    }
    return arms;
}

function checkViewsFollowSystem() {
    const presets = casePresets();
    let offeredTotal = 0;
    const counts = [];
    for (const preset of presets) {
        appSelectPreset(preset.id);
        const system = appSystem();
        const solved = new Set(system.equations.map((e) => e.field));
        const plate = new Plate(3, appCoarsestInterior());
        const code = drawCodeFor(plate, system);
        const arms = drawArms(code);
        const offered = viewsOffered(system);
        offeredTotal += offered.length;
        counts.push(`${preset.id}:${offered.length}`);
        for (const name of offered) {
            const arm = arms.get(VIEW_NAMES.indexOf(name));
            check(`${preset.id}: the offered view "${name}" has an arm in the draw shader`, arm !== undefined);
            if (!arm) continue;
            for (const [pattern, fields] of VIEW_ARM_READS) {
                if (!pattern.test(arm)) continue;
                for (const field of fields) {
                    check(`${preset.id}: the "${name}" view reads ${field}, which the case solves`,
                        solved.has(field));
                }
            }
            for (const field of armArraysRead(arm)) {
                if (field.startsWith('species')) continue;   // the mixture, checked below
                check(`${preset.id}: the "${name}" view reads ${field}, which the case solves`,
                    solved.has(field));
            }
            if (/centerState\.species[ABC]\b/.test(arm)) {
                check(`${preset.id}: the "${name}" view reads the species, and the case solves one`,
                    ['speciesA', 'speciesB', 'speciesC'].some((f) => solved.has(f)));
            }
        }
        // The material arm paints every material the legend lists, in the
        // color the legend shows, read from the arm's text.
        if (offered.includes('material')) {
            const arm = arms.get(VIEW_NAMES.indexOf('material')) || '';
            check(`${preset.id}: offered the material view, and declares its materials`,
                Array.isArray(system.materials));
            for (const { label, color } of system.materials || []) {
                const rgb = `vec3f(${color.map(wgslLiteral).join(', ')})`;
                check(`${preset.id}: the material arm paints ${label} in its own color`,
                    arm.includes(`// ${label}`) && arm.includes(rgb));
            }
        }
        // One diffusivity arm per advected field, so the row and the switch
        // cannot come to name different fields.
        const advected = drawAdvectedEquations(system).length;
        const diffusivityArms = (code.match(/fn drawDiffusivityOf[\s\S]*?\n {8}\}/) || [''])[0]
            .split('\n').filter((line) => /case \d+u|default \{ return 1\.0/.test(line)).length;
        check(`${preset.id}: one diffusivity arm per advected field`,
            diffusivityArms === Math.max(1, advected), `${diffusivityArms} arms, ${advected} advected fields`);
    }
    // The positive control: some case must be offered fewer views, or a filter
    // that let everything through would pass.
    appSelectPreset('patternGrayScott');
    const pattern = viewsOffered(appSystem());
    check('a case with no flow is offered no velocity, pressure or temperature view',
        !['velocity', 'pressure', 'temperature', 'vorticity', 'cell Peclet'].some((v) => pattern.includes(v)),
        pattern.join(', '));

    // The material view draws only what is fixed in space: offered where a
    // profile is, and never for a coefficient that moves with a field. Both
    // halves, and the refusals that keep the legend's list true.
    const withProfile = presets.filter((p) => p.display.materials);
    const fieldOnly = presets.find((p) => p.coefficients.diffusivityTemperatureSensitivity > 0
        && !p.coefficients.massDiffusivityProfile && !p.coefficients.thermalDiffusivityProfile);
    const material = (preset) => {
        appSelectPreset(preset.id);
        return viewsOffered(appSystem()).includes('material');
    };
    check('every case that declares materials is offered the material view',
        withProfile.length > 0 && withProfile.every(material),
        withProfile.filter((p) => !material(p)).map((p) => p.id).join(', '));
    check('a case with no profile is not', !material(presets.find((p) => p.id === 'lidDrivenCavity')));
    check('nor one whose only varying coefficient depends on temperature',
        !!fieldOnly && !material(fieldOnly), fieldOnly ? fieldOnly.id : 'no such case');
    const wall = presets.find((p) => p.coefficients.thermalDiffusivityProfile);
    const refuses = (materials) => {
        try { drawMaterials({ ...physicsSystem(wall), materials }); return false; }
        catch (error) { return true; }
    };
    check('a material list missing a value its profile takes is refused',
        refuses(wall.display.materials.slice(0, -1)));
    check('so is one naming a value its profile never takes',
        refuses([...wall.display.materials, { label: 'unused', factor: 3, color: [0, 0, 0] }]));
    check('and the case\'s own list is accepted', !refuses(wall.display.materials));
    return { presets: presets.length, offeredTotal, counts };
}

// The species row against the species arm of the generated draw shader. Each
// button carries a viewSpecies value and names a field; the arm decides which
// color component that value keeps. Read from the shader text, never from the
// list that generated it, so a generator that drifted from the row goes red: the
// value a button sends must keep exactly the component that samples the array
// the button names, that array must be one the case solves, and 0 must keep
// every component, since 0 is the mixture.
function checkSpeciesRowFollowsSystem() {
    const presets = casePresets();
    let buttons = 0;
    for (const preset of presets) {
        appSelectPreset(preset.id);
        const system = appSystem();
        const solved = new Set(system.equations.map((e) => e.field));
        const offered = drawOfferedSpecies(system);
        if (!offered.length) continue;
        const plate = new Plate(3, appCoarsestInterior());
        const code = drawCodeFor(plate, system);
        const arm = drawArms(code).get(VIEW_NAMES.indexOf('species')) || '';

        // The array each component of the sampled vector reads, in component
        // order (null for a species the case does not allocate, which reads a
        // literal zero), then the keep-mask that multiplies it.
        const rawBody = (arm.match(/let raw = vec\df\(([\s\S]*?)\);\n/) || [])[1] || '';
        const order = rawBody.split(/,\s*\n\s*/).map((text) =>
            ((text.match(/drawBilinearIfOn\(centerState\.(\w+)\[p\]/) || [])[1] || null));
        const multiplied = /let shown = max\(raw, vec\df\(0\.0\)\) \* keep/.test(arm);
        check(`${preset.id}: the keep-mask multiplies the sampled vector`, multiplied);
        const keepBody = (arm.match(/let keep = vec\df\(([\s\S]*?)\);/) || [])[1] || '';
        const components = keepBody.split(/,\s*(?=f32\()/)
            .map((text) => [...text.matchAll(/viewSpecies == (\d+)u/g)].map((m) => Number(m[1])));
        check(`${preset.id}: the species arm has one keep component per sampled species`,
            components.length === order.length && order.some(Boolean)
                && order.every((field, k) => field !== null || /^\s*0\.0\s*$/.test(rawBody.split(/,\s*\n\s*/)[k])),
            `${components.length} components, ${order.length} sampled`);
        check(`${preset.id}: every keep component admits the mixture (0)`,
            components.every((values) => values.includes(0)));

        for (const { field, value } of offered) {
            if (field === null) continue;
            buttons++;
            const kept = components.map((values) => values.includes(value));
            const at = kept.indexOf(true);
            check(`${preset.id}: the "${field}" button's value ${value} keeps one component`,
                kept.filter(Boolean).length === 1, kept.join(', '));
            check(`${preset.id}: the "${field}" button's value ${value} keeps the component sampling ${field}`,
                order[at] === field, `it keeps the one sampling ${order[at]}`);
            check(`${preset.id}: the "${field}" button names a species the case solves`, solved.has(field));
        }
        // The converse: a species the case solves and the shader samples gets
        // a button. Without it, a row that dropped the fourth species would
        // pass every check above, since each button it did offer is right.
        const named = new Set(offered.map(({ field }) => field));
        for (const field of order.filter(Boolean)) {
            check(`${preset.id}: the sampled species ${field} has a button`,
                !solved.has(field) || named.has(field));
        }
    }
    // The positive control: a case with two species is offered fewer buttons
    // than the shader has components.
    appSelectPreset('patternGrayScott');
    const pattern = drawOfferedSpecies(appSystem()).map(({ field }) => field);
    check('a case solving A and B is offered no button for C',
        !pattern.includes('speciesC') && pattern.length === 3, pattern.join(', '));
    // And a reacting flow case, which solves A, B and C, is offered no button
    // for D; the same case with no reaction makes no C and is offered none.
    appSelectPreset('emptyChannelMassAction');
    const flow = drawOfferedSpecies(appSystem()).map(({ field }) => field);
    check('a case solving A, B and C is offered no button for D',
        !flow.includes('speciesD') && flow.length === 4, flow.join(', '));
    appSelectPreset('emptyChannel');
    const inert = drawOfferedSpecies(appSystem()).map(({ field }) => field);
    check('the same case with no reaction solves no C and is offered no button for it',
        !inert.includes('speciesC') && inert.length === 3, inert.join(', '));
    return { presets: presets.length, buttons };
}

function main() {
    console.log('verify_views.js: the views and species each case offers');

    heading('THE VIEWS FOLLOW THE SYSTEM');
    const views = section('the views follow the system', checkViewsFollowSystem);
    if (views) {
        console.log(`  ${views.presets} presets, ${views.offeredTotal} offered views checked against`);
        console.log('  the arms the draw shader takes for them.');
    }

    heading('THE SPECIES ROW FOLLOWS THE SYSTEM');
    const speciesRow = section('the species row follows the system', checkSpeciesRowFollowsSystem);
    if (speciesRow) {
        console.log(`  ${speciesRow.presets} presets, ${speciesRow.buttons} species buttons checked against`);
        console.log('  the keep-mask the draw shader generates for them.');
    }

    heading('RESULT');
    console.log(`  ${passCount} checks passed.`);
    if (failures.length) {
        console.log(`  ${failures.length} FAILED:`);
        for (const f of failures.slice(0, 40)) console.log(`    ${f}`);
        if (failures.length > 40) console.log(`    ... and ${failures.length - 40} more`);
    }

    process.exitCode = failures.length === 0 ? 0 : 1;
}

main();
});
