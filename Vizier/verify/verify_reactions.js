// verify_reactions.js, by Allen Rakhamimov.
// Each reaction line the panel writes, against the terms tagged with it.
//
// The panel gathers a reaction's terms by their tag and writes its formula
// from them. A term with no tag would drop out of its line, and terms that
// disagree about the rate would write a wrong formula; both are checked over
// every preset, and the line is read back against each term's own rate.

// verify.html loads it, then runs the body it registers.
verifyCheck('verify_reactions.js', function (process) {
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

// The reaction lines are gathered from tagged terms, so what can go wrong is a
// term with no tag, which drops out of the line, or a reaction whose terms
// disagree about what the rate multiplies. Both are checked over every preset,
// and the line read back as mass action must give each tagged term's rate: a
// species' net change per unit of reaction, times the reference rate, is the
// rate that species' term declares.
const REACTION_ENTRIES = ['reactionSink', 'reactionSource', 'saturatingSink',
    'saturatingSource', 'firstOrderSink', 'secondOrderSink'];

function checkReactionLines() {
    const lines = new Map();
    for (const preset of casePresets()) {
        appSelectPreset(preset.id);
        const system = appSystem();
        const values = appCoefficientValues();
        for (const equation of system.equations) {
            if (!fieldSpecOf(equation.field).formula) continue;
            for (const term of equation.terms) {
                if (!REACTION_ENTRIES.includes(term.term)) continue;
                check(`${preset.id}: the ${term.term} on ${equation.field} names its reaction`,
                    typeof term.reaction === 'string' && term.reaction.length > 0);
            }
        }
        const reactions = panelReactions(system, values);
        for (const reaction of reactions) {
            check(`${preset.id}: every term of reaction ${reaction.name} multiplies the same species`,
                reaction.factorsAgree);
            check(`${preset.id}: reaction ${reaction.name} has a left-hand side`, reaction.left.length > 0);
            // The arrow carries the EVENT rate, the reference term's rate over
            // its own stoichiometric change. Where that change is one the two
            // are the same symbol; where it is not (2A -> enters A's balance at
            // twice the event rate) the arrow must not repeat the term's symbol,
            // which is what the read-back above cannot see, since it is numeric.
            if (!rateIsArrhenius(reaction.rate)) {
                const arrow = panelReactionRate(reaction);
                const term = panelCoefficientSymbol(reaction.rate, 'rate', reaction.field, reaction.name);
                check(`${preset.id}: reaction ${reaction.name}'s arrow writes the event rate`,
                    reaction.change === 1 ? arrow === term : arrow !== term,
                    `change ${reaction.change}, arrow ${arrow}, term ${term}`);
            }
        }
        // Read back: for each tagged species term, (right - left) of its species
        // times the reference rate is the rate that term declares, with the
        // sign of a source or a sink.
        const net = new Map();
        for (const reaction of reactions) {
            const change = {};
            for (const [amount, field] of reaction.left) change[field] = (change[field] || 0) - amount;
            for (const [amount, field] of reaction.right) change[field] = (change[field] || 0) + amount;
            net.set(reaction.name, { change, scale: reaction.scale });
        }
        for (const equation of system.equations) {
            if (!fieldSpecOf(equation.field).formula) continue;
            const declared = {};
            for (const term of equation.terms) {
                if (!term.reaction) continue;
                const sign = term.term.endsWith('Source') ? 1 : -1;
                declared[term.reaction] = (declared[term.reaction] || 0)
                    + sign * panelRateBase(term.rate, values);
            }
            for (const [name, rate] of Object.entries(declared)) {
                const line = net.get(name);
                const fromLine = line ? (line.change[equation.field] || 0) * line.scale : NaN;
                check(`${preset.id}: reaction ${name}'s line reproduces the rate on ${equation.field}`,
                    Math.abs(fromLine - rate) <= 1e-9 * Math.max(1, Math.abs(rate)),
                    `line gives ${fromLine}, term declares ${rate}`);
            }
        }
        const text = panelReactionText(system).join('  |  ');
        if (text && !lines.has(text)) lines.set(text, preset.id);
    }
    return lines;
}

function main() {
    console.log('verify_reactions.js: the reaction lines follow the terms');

    heading('THE REACTION LINES FOLLOW THE TERMS');
    const reactionLines = section('the reaction lines follow the terms', checkReactionLines);
    if (reactionLines) {
        for (const [text, id] of reactionLines) console.log(`  ${id.padEnd(28)} ${text}`);
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
