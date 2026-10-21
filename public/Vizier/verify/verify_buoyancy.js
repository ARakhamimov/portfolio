// verify_buoyancy.js, by Allen Rakhamimov.
// A source proportional to another field, and a case that asks for zero
// viscosity.
//
// proportionalSource puts +/-k (phi - phi_ref) on a row, with phi a field
// stored at cell centers and averaged to the row's own location. It is how a
// density difference drives a momentum row. Two things are checked from the
// case declarations:
//
//   1. Every buoyant case puts the term on its y velocity and nowhere else,
//      with the field it declares and the buoyancy slot. Cases are found by
//      their buoyancy, not by name.
//   2. A case asking for zero viscosity carries no diffusion term on momentum,
//      so the panel prints what was asked, and the panel reports a finite
//      viscosity at peak speed.
//
// Not checked: no WGSL runs or is read, so the average the term takes and the
// blend at zero diffusivity are not examined. Nor does it say how a buoyant
// case looks; that is for the browser.

// verify.html loads it, then runs the body it registers.
verifyCheck('verify_buoyancy.js', function (process) {
'use strict';

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

function section(name, run) {
    heading(name);
    try { run(); } catch (error) {
        failures.push(`${name}: raised ${error && error.message}`);
        console.log(`  RAISED: ${error && error.message}`);
    }
}

function main() {
console.log('verify_buoyancy.js: a source proportional to another field, and zero viscosity');

section('1. EVERY BUOYANT CASE PUSHES ITS Y VELOCITY, AND ONLY THAT', () => {
    let cases = 0;
    for (const preset of casePresets()) {
        if (!(preset.coefficients.buoyancy > 0)) continue;
        const system = physicsSystem(preset);
        for (const equation of system.equations) {
            const found = equation.terms.filter((term) => term.term === 'proportionalSource');
            if (equation.field === 'yVelocity') {
                check(`${preset.id}: one buoyancy term on the y velocity`, found.length === 1,
                    `${found.length} found`);
                if (found[0]) {
                    check(`${preset.id}: the term reads ${preset.system.buoyantField.field}`,
                        found[0].field === preset.system.buoyantField.field
                        && found[0].sign === preset.system.buoyantField.sign
                        && found[0].coefficient.coefficientSlot === 'buoyancy',
                        JSON.stringify(found[0]));
                }
            } else {
                check(`${preset.id}: no buoyancy term on ${equation.field}`, found.length === 0);
            }
        }
        console.log(`  ${preset.id}: ${preset.system.buoyantField.sign}gβ on v from `
            + `${preset.system.buoyantField.field}, reference ${preset.system.buoyantField.reference}`);
        cases++;
    }
    if (cases === 0) failures.push('section 1 is trivially met: no preset is buoyant');
});

section('2. A CASE ASKING FOR ZERO VISCOSITY IS PRINTED AS ASKED', () => {
    let cases = 0;
    for (const preset of casePresets()) {
        if (!(preset.system.physics === 'flow' && preset.coefficients.viscosity === 0)) continue;
        const system = physicsSystem(preset);
        for (const equation of system.equations) {
            if (equation.role !== 'velocity') continue;
            check(`${preset.id}: no diffusion term on ${equation.field}`,
                !equation.terms.some((term) => term.term === 'diffusion'));
        }
        const summary = caseSummary(preset, { spacing: [1 / 256] }, 1);
        check(`${preset.id}: the panel delivers a finite viscosity at peak speed`,
            Number.isFinite(summary.effectiveViscosity) && summary.effectiveViscosity > 0,
            String(summary.effectiveViscosity));
        cases++;
    }
    console.log(`  ${cases} presets ask for zero viscosity and carry no diffusion on momentum.`);
    if (cases === 0) failures.push('section 2 is trivially met: no preset asks for zero viscosity');
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
