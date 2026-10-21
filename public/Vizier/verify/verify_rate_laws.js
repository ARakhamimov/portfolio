// verify_rate_laws.js, by Allen Rakhamimov.
// The three rate laws on one case, at one Damkohler number.
//
// Every case that feeds both A and B offers no reaction, mass action,
// Michaelis-Menten and Monod, so that the rate law is the only thing that
// changes between them. This checks that through the panel's own number: the
// three report the same Damkohler number on each such case, Monod declares a
// growth rate and a yield and not the uptake rate directly, and the uptakeRate
// slot the shader reads is the rate the panel's number is built from. Cases are
// found from the presets, so a case that gains the standard reactions is
// checked without an edit.
//
// Not checked: it reads declarations and the host's slot values, and does not
// run any rate law or read the text the rate laws emit. The three agree
// trivially where the Damkohler number is zero, as on a case with no flow.

// verify.html loads it, then runs the body it registers.
verifyCheck('verify_rate_laws.js', function (process) {
'use strict';

let passCount = 0;
const failures = [];

function check(name, condition, detail) {
    if (condition) { passCount++; return; }
    failures.push(detail ? `${name}  --  ${detail}` : name);
}

function checkClose(name, got, want, tolerance, detail) {
    const error = Math.abs(got - want) / Math.max(1, Math.abs(want));
    check(name, error <= tolerance,
        `${detail ? detail + ' ' : ''}got ${got}, want ${want}, relative ${error.toExponential(3)}`);
    return error;
}

function heading(text) {
    console.log('');
    console.log(text);
    console.log('-'.repeat(text.length));
}

// Comparing the three rate laws rests on the three presets being identical in
// geometry, feed, mesh and coefficients. If they reported different Damkohler
// numbers, a viewer would conclude the rate law moved the balance between
// chemistry and transport when it did not. Monod declares a growth rate and
// consumes substrate at rate over yield, so the panel's number is not the
// constant the preset declares.
function checkPresetDamkohler() {
    heading('EVERY CASE OFFERING THE RATE LAWS REPORTS ONE DAMKOHLER');

    // Read from the presets, so a case that gains the standard reactions is
    // checked with the rest. The three laws on one case must agree; each case's
    // own number is whatever its geometry makes it.
    const laws = ['massAction', 'michaelisMenten', 'monod'];
    const presets = casePresets();
    const cases = [...new Set(presets.filter((p) => p.reaction === 'monod').map((p) => p.caseId))];
    check('some case offers the three rate laws', cases.length > 0, `${cases.length} cases`);

    console.log('  case                           none   mass action   Michaelis-M.      Monod');
    for (const caseId of cases) {
        const pairOf = (name) => presets.find((p) => p.caseId === caseId && p.reaction === name);
        check(`${caseId} offers none and all three laws`,
            [...laws, 'none'].every((name) => pairOf(name)), caseId);
        if (![...laws, 'none'].every((name) => pairOf(name))) continue;
        const numbers = laws.map((name) => {
            const preset = pairOf(name);
            const plate = new Plate(MESH_SIZES.indexOf(preset.solver.cells), preset.solver.coarsestCells);
            return caseSummary(preset, plate).damkohler;
        });
        const none = pairOf('none');
        console.log(`  ${caseId.padEnd(29)}  ${String(none.coefficients.reactionRate).padStart(4)}   `
            + numbers.map((n) => n.toFixed(4).padStart(11)).join('    '));
        check(`${caseId}: no reaction means a rate of zero`, none.coefficients.reactionRate === 0);
        const spread = Math.max(...numbers) / Math.min(...numbers);
        check(`${caseId}: the three rate laws sit at one Damkohler number`,
            spread < 1.001 || Math.max(...numbers) === 0, `spread ${spread.toFixed(4)}x`);

        // Monod declaring the uptake rate directly would make the agreement
        // above true by construction. A growth rate and a yield are what Monod
        // is, and converting between them is what the panel has to get right.
        const monod = pairOf('monod');
        check(`${caseId}: Monod declares a growth rate and a yield rather than the uptake rate`,
            monod.coefficients.yieldCoefficient > 0 && monod.coefficients.reactionRate !== pairOf('massAction').coefficients.reactionRate,
            `rate ${monod.coefficients.reactionRate}, yield ${monod.coefficients.yieldCoefficient}`);

        // The panel and the shader agree about the substrate rate: the shader
        // reads the uptakeRate slot the host computes, and the panel computes
        // its own.
        appSelectPreset(monod.id);
        checkClose(`${caseId}: the uptakeRate slot matches the rate the Damkohler is built from`,
            appCoefficientValues().uptakeRate, monod.coefficients.reactionRate / monod.coefficients.yieldCoefficient, 1e-12);
    }
    appSelectPreset('cylinderWake');
}

function main() {
    console.log('RATE LAW PARITY');
    console.log('One Damkohler number per case across mass action, Michaelis-Menten and Monod.');
    checkPresetDamkohler();
}

function guarded(name, body) {
    try {
        body();
    } catch (error) {
        failures.push(`${name} raised: ${error.message}`);
    }
}

function report() {
    heading('RESULT');
    console.log(`  ${passCount} checks passed.`);
    if (failures.length) {
        console.log(`  ${failures.length} FAILED:`);
        for (const f of failures.slice(0, 40)) console.log(`    ${f}`);
        if (failures.length > 40) console.log(`    ... and ${failures.length - 40} more`);
    }
    console.log('');
    console.log('  Declarations and host slot values only; no rate law is evaluated here.');

    process.exitCode = failures.length === 0 ? 0 : 1;
}

guarded('main', main);
report();
});
