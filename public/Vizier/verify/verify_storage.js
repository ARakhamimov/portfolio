// verify_storage.js, by Allen Rakhamimov.
// The storage each system needs, and the arrays its generated WGSL reads.
//
// A case is given arrays only for the fields its system uses
// (simulationFields), so a new field costs only the cases that solve it. Every
// preset's buffers at 1024 are checked against the binding limit, and every
// array its generated WGSL reads is checked to exist in the struct its plate
// generates. The positive control is the full workspace every check's plate
// keeps, which does not fit at 1024.
//
// Not checked: no WGSL runs here. The binding limit is WebGPU's default, and a
// device that grants more is not consulted.

// verify.html loads it, then runs the body it registers.
verifyCheck('verify_storage.js', function (process) {
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

// Every array name a piece of WGSL reads from a buffer group.
function readsFrom(source, group) {
    const found = new Set();
    for (const match of source.matchAll(new RegExp(`\\b${group}\\.(\\w+)`, 'g'))) found.add(match[1]);
    return found;
}

function membersOf(source, structName) {
    const body = source.match(new RegExp(`struct ${structName} \\{([^}]*)\\}`));
    if (!body) throw new Error(`no struct ${structName} in the generated WGSL`);
    return new Set([...body[1].matchAll(/(\w+)\s*:/g)].map((match) => match[1]));
}

function checkStorage() {
    const result = [];
    // A 1024 plate is slow to classify, so one per coarsest level, and each
    // group's size from its arrays' lengths there.
    const large = {};
    for (const preset of casePresets()) {
        appSelectPreset(preset.id);
        const solved = appAllocatedFields();
        const coarsest = appCoarsestInterior();
        large[coarsest] = large[coarsest] || new Plate(0, coarsest);
        const plate = new Plate(MESH_SIZES.indexOf(32), 16, solved);
        const largest = Math.max(...BUFFER_GROUPS.map((group) => plate.arraysInGroup(group)
            .reduce((bytes, array) => bytes + 4 * (large[coarsest][array.name] || plate[array.name]).length, 0)));
        appGeometry(plate);
        const source = buildSimulationSource(plate, appSystem(), appBoundaryTable(), 8, appActivePreset().display);
        result.push({ id: preset.id, largest, source });
    }
    let worst = { largest: 0 };
    let missing = 0;
    for (const row of result) {
        if (row.largest > worst.largest) worst = row;
        check(`${row.id}: every buffer fits the binding limit at 1024`, row.largest <= MAX_STORAGE_BINDING_BYTES,
            `${(row.largest / 1048576).toFixed(1)} MiB`);
        for (const group of BUFFER_GROUPS) {
            const struct = group.name[0].toUpperCase() + group.name.slice(1);
            const members = membersOf(row.source, struct);
            for (const name of readsFrom(row.source, group.name)) {
                if (!members.has(name)) missing++;
                check(`${row.id}: ${group.name}.${name} is in the struct`, members.has(name));
            }
        }
    }
    console.log(`  ${result.length} presets; the largest buffer at 1024 is `
        + `${(worst.largest / 1048576).toFixed(1)} MiB (${worst.id}) against `
        + `${(MAX_STORAGE_BINDING_BYTES / 1048576).toFixed(0)} MiB; ${missing} reads of an array not allocated`);
    // The positive control: the full workspace every check's plate keeps does
    // not fit.
    const full = new Plate(0, 32);
    check('the full workspace would not fit at 1024, so the reduction is doing work',
        full.bufferBytes('centerWorkspace') > MAX_STORAGE_BINDING_BYTES,
        `${(full.bufferBytes('centerWorkspace') / 1048576).toFixed(1)} MiB`);
}

function main() {
    console.log('verify_storage.js: the storage each system needs');
    section('STORAGE PER SYSTEM', checkStorage);

    heading('RESULT');
    console.log(`${passCount} checks passed.`);
    if (failures.length) {
        console.log(`${failures.length} FAILED:`);
        for (const failure of failures.slice(0, 30)) console.log(`  ${failure}`);
        process.exitCode = 1;
    } else {
        console.log('All storage checks passed.');
    }
}

main();
});
