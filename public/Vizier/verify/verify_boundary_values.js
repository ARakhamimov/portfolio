// verify_boundary_values.js, by Allen Rakhamimov.
// A boundary value a slider moves.
//
// A Dirichlet value in the boundary table may name a coefficient slot instead
// of a number, so a viewer can move a wall or feed temperature with a buffer
// write. A heated section's target may do the same. Four things have to hold,
// one per section:
//
//   1. The generated shader reads the slot where, and only where, a case lists
//      a slider for the value (the temperatures, and the thermal diffusivity,
//      a coefficient that opts in the same way). This reads the WGSL each preset
//      emits, so it catches a generator that ignored the table as readily as a
//      case that forgot to list a name.
//   2. The linearized Arrhenius reference T0 does not follow the feed slider,
//      and the panel's Damkohler number at the feed does, summed over every
//      reaction that consumes the feed. A viewer's values are laid over the
//      finished preset, so a T0 read off the feed temperature would move on any
//      rebuild; a feed moved away from T0 changes the rate there by
//      exp(s (T_feed - T0)).
//   3. Every slider a case lists moves a slot its generated shader reads, and
//      every slot the shader reads has a slider listed.
//   4. A flow case solves temperature exactly where something can move it from
//      its starting value.
//
// Not checked: no WGSL runs here, so the ghost values a slot produces on the
// GPU are not read back, only the emitted text. Nor does anything here touch
// the slider itself, which is page DOM.

// verify.html loads it, then runs the body it registers.
verifyCheck('verify_boundary_values.js', function (process) {
'use strict';

const OPTIONAL_SLOTS = ['wallTemperature', 'inletTemperature', 'heaterTemperature',
    'thermalDiffusivity'];

let passCount = 0;
const failures = [];

function check(name, condition, detail) {
    if (condition) { passCount++; return; }
    failures.push(detail ? `${name}  --  ${detail}` : name);
}

function heading(title) {
    console.log('');
    console.log(title);
    console.log('-'.repeat(title.length));
}

// A section that raises is recorded as a failure and the run carries on, so
// the verdict below is always printed.
function section(title, body) {
    heading(title);
    try { body(); } catch (error) {
        failures.push(`${title}: raised ${error && error.message}`);
        console.log(`  RAISED: ${error && error.message}`);
    }
}

function main() {

section('1. THE GENERATED SHADER READS A SLOT WHERE A CASE LISTS IT', () => {
    let presets = 0, listed = 0;
    for (const preset of casePresets()) {
        appSelectPreset(preset.id);
        const plate = new Plate(appFinestIndex(), appCoarsestInterior());
        appGeometry(plate);
        const source = buildSimulationSource(plate, appSystem(), appBoundaryTable(), 8, appActivePreset().display);
        for (const name of OPTIONAL_SLOTS) {
            const wanted = caseHasSlider(preset, name);
            const read = source.includes(`coefficients.${name}`);
            check(`${preset.id}: ${name}`, read === wanted,
                wanted ? 'listed but the shader never reads its slot'
                       : 'not listed but the shader reads its slot');
            if (wanted) listed++;
        }
        presets++;
    }
    console.log(`  ${presets} presets emitted, ${listed} listed values read from their slots,`);
    console.log('  and no unlisted one read from a slot anywhere.');
    if (listed === 0) failures.push('section 2 is trivially met: no preset lists a temperature');
});

section('2. T0 STAYS PUT, AND THE FEED DAMKOHLER NUMBER MOVES', () => {
    const exponent = /\(centerState\.temperature\[(?:p|here)\] - ([0-9.eE+-]+)\)/g;
    const references = (source) => new Set([...source.matchAll(exponent)].map((m) => Number(m[1])));

    let cases = 0;
    for (const preset of casePresets()) {
        if (!(preset.coefficients.temperatureSensitivity > 0)) continue;
        cases++;
        check(`${preset.id}: T0 defaults to the declared feed`,
            preset.coefficients.referenceTemperature === preset.inlet.temperature,
            `T0 ${preset.coefficients.referenceTemperature}, feed ${preset.inlet.temperature}`);
        if (!caseHasSlider(preset, 'inletTemperature')) continue;

        const shift = 30;
        const build = () => {
            const plate = new Plate(appFinestIndex(), appCoarsestInterior());
            appGeometry(plate);
            return { plate, source: buildSimulationSource(plate, appSystem(), appBoundaryTable(), 8, appActivePreset().display) };
        };
        appSelectPreset(preset.id);
        const base = build();
        const baseSummary = caseSummary(appActivePreset(), base.plate, NaN);
        appSetCoefficient('inletTemperature', preset.inlet.temperature + shift);
        const moved = build();
        const movedSummary = caseSummary(appActivePreset(), moved.plate, NaN);
        appSelectPreset(preset.id);

        const before = references(base.source), after = references(moved.source);
        check(`${preset.id}: the shader linearizes about one temperature`, before.size === 1,
            `found ${[...before].join(', ')}`);
        check(`${preset.id}: a rebuild with the feed moved keeps T0`,
            after.size === 1 && after.has(preset.coefficients.referenceTemperature),
            `found ${[...after].join(', ')}`);

        // Every reaction consuming the feed contributes at its own sensitivity:
        // the ratio is a rate-weighted mean of exp(s dT) over the main reaction
        // and, where there is one, the side reaction.
        const ratio = movedSummary.damkohler / baseSummary.damkohler;
        const rates = [[preset.coefficients.reactionRate, preset.coefficients.temperatureSensitivity],
            [preset.coefficients.sideReactionRate || 0, preset.coefficients.sideTemperatureSensitivity || 0]];
        const expected = rates.reduce((sum, [k, s]) => sum + k * Math.exp(s * shift), 0)
            / rates.reduce((sum, [k]) => sum + k, 0);
        check(`${preset.id}: the feed Damkohler number scales by the rate-weighted exp(s dT)`,
            Math.abs(ratio / expected - 1) < 1e-12, `ratio ${ratio}, expected ${expected}`);
        console.log(`  ${preset.id}: T0 ${preset.coefficients.referenceTemperature} before and after a feed `
            + `move of ${shift}; Da at the feed x${ratio.toFixed(2)} (expected ${expected.toFixed(2)}).`);
    }
    if (cases === 0) failures.push('section 3 is trivially met: no preset is temperature-dependent');
});

// Each slider a preset offers has to feed a slot that preset's generated shader
// reads. The slots each slider feeds come from controls.js, and whether the
// shader reads them is read off the WGSL, so a case whose system lost the term
// a slider moves (a viscosity slider on a case with no momentum row) fails
// here. The positive control is the conduction case, which declares a viscosity
// of zero and offers exactly one slider.
section('3. EVERY SLIDER MOVES A SLOT THE SHADER READS', () => {
    let offered = 0, presets = 0;
    const listing = {};
    for (const preset of casePresets()) {
        appSelectPreset(preset.id);
        const plate = new Plate(appFinestIndex(), appCoarsestInterior());
        appGeometry(plate);
        const source = buildSimulationSource(plate, appSystem(), appBoundaryTable(), 8, appActivePreset().display);
        const sliders = controlsOfferedSliders(preset, appSystem());
        for (const [name] of sliders) {
            const feeds = coefficientSlotsFedBy(name);
            check(`${preset.id}: the ${name} slider moves a slot the shader reads`,
                feeds.some((slot) => source.includes(`coefficients.${slot}`)),
                `it feeds ${feeds.join(', ')}, and the shader reads none of them`);
            offered++;
        }
        // The converse, so a rule that hides too much fails as well as one that
        // hides too little: a constant this preset declares, whose slot the
        // shader reads, has a slider.
        const names = sliders.map(([name]) => name);
        for (const { name } of COEFFICIENT_SLIDERS) {
            if (!(caseControlValue(preset, name) > 0) || names.includes(name)) continue;
            if (OPTIONAL_SLOTS.includes(name) && !caseHasSlider(preset, name)) continue;
            const feeds = coefficientSlotsFedBy(name);
            check(`${preset.id}: the ${name} slider is offered`,
                !feeds.some((slot) => source.includes(`coefficients.${slot}`)),
                `the shader reads ${feeds.join(' or ')} and the page offers no slider for it`);
        }
        listing[preset.id] = names;
        presets++;
    }
    const conduction = casePresets().find((p) => p.system.physics === 'conduction');
    check('the conduction case offers only its thermal diffusivity',
        conduction && listing[conduction.id].join() === 'thermalDiffusivity',
        conduction ? listing[conduction.id].join(', ') : 'no conduction case');
    const pattern = casePresets().find((p) => p.system.physics === 'reactionDiffusion');
    check('the reaction-diffusion case offers no viscosity',
        pattern && !listing[pattern.id].includes('viscosity'),
        pattern ? listing[pattern.id].join(', ') : 'no reaction-diffusion case');
    console.log(`  ${presets} presets, ${offered} sliders, each feeding a slot its shader reads.`);
    if (conduction) console.log(`  ${conduction.id}: ${listing[conduction.id].join(', ')}`);
    if (pattern) console.log(`  ${pattern.id}: ${listing[pattern.id].join(', ')}`);
});

// Held from outside: each flow preset is built with its temperature equation
// forced in, then asked whether anything could move T from its starting value:
// a Dirichlet value of another temperature on a type the plate has, a term on T
// beyond transport, a term elsewhere that reads T, or a coefficient slot on T's
// own row. A preset that drops T has none of these, and one that keeps it has
// at least one, or it would be solving a flat field.
section('4. TEMPERATURE IS SOLVED EXACTLY WHERE SOMETHING CAN MOVE IT', () => {
    let kept = 0, dropped = 0;
    const readsTemperature = (value) => {
        if (!value || typeof value !== 'object') return false;
        if (value.field === 'temperature') return true;
        return Object.values(value).some(readsTemperature);
    };
    for (const preset of casePresets()) {
        if (preset.system.physics !== 'flow') continue;
        appSelectPreset(preset.id);
        const plate = new Plate(appFinestIndex(), appCoarsestInterior());
        appGeometry(plate);
        const types = new Set(plate.typeCenter);
        const table = physicsBoundaryTable(preset);
        const start = preset.initial.temperature !== undefined
            ? preset.initial.temperature : preset.inlet.temperature;
        const reasons = [];
        for (const type of types) {
            const row = table[type] || {};
            const entry = (row.fields && row.fields.temperature) || row[ROLE_SCALAR];
            if (!entry || entry.surface.kind !== DIRICHLET) continue;
            const value = entry.surface.value;
            if (typeof value !== 'number' || value !== start) reasons.push(`a boundary of type ${type}`);
        }
        const full = physicsFlowSystem(preset, { solveTemperature: true });
        for (const equation of full.equations) {
            for (const term of equation.terms) {
                if (equation.field === 'temperature') {
                    if (!['timeDerivative', 'diffusion', 'advection'].includes(term.term)) {
                        reasons.push(`a ${term.term} on T`);
                    }
                    if (term.term === 'diffusion' && coefficientIsSlot(term.diffusivity)) {
                        reasons.push('a slider on its diffusivity');
                    }
                } else if (readsTemperature(term)) {
                    reasons.push(`${equation.field} reads T`);
                }
            }
        }
        const solves = physicsSystem(preset).equations.some((e) => e.field === 'temperature');
        check(`${preset.id}: temperature ${solves ? 'solved' : 'dropped'}`,
            solves === (reasons.length > 0),
            solves ? 'solved, but nothing in the case can move it'
                   : `dropped, but ${reasons.join(', ')} would`);
        if (solves) kept++; else dropped++;
    }
    console.log(`  ${kept} flow presets solve temperature and each has something that moves it;`);
    console.log(`  ${dropped} drop it, and forcing it back in finds nothing that would.`);
    if (kept === 0 || dropped === 0) failures.push('section 5 is trivially met on one side');
});

heading('RESULT');
console.log(`  ${passCount} checks passed.`);
if (failures.length) {
    console.log(`  ${failures.length} FAILED:`);
    for (const f of failures.slice(0, 40)) console.log(`    ${f}`);
}
process.exitCode = failures.length === 0 ? 0 : 1;
}

main();
});
