// verify_layout.js, by Allen Rakhamimov.
// The storage layout's arithmetic, on its own.
//
// No WebGPU, no browser, no solver. A fencepost or half-cell error here would
// surface later as a physics bug and not as a crash, under the dictionary and
// the generator that sit on top of it. The alignment checks are written against
// physical positions, since index arithmetic checked against index arithmetic
// only shows the same mistake was made twice.

// verify.html loads it, then runs the body it registers.
verifyCheck('verify_layout.js', function (process) {
'use strict';

const TOL = 1e-9;

let passCount = 0;
const failures = [];

function check(name, condition, detail) {
    if (condition) { passCount++; return; }
    failures.push(detail ? `${name}  --  ${detail}` : name);
}

// A check that a call fails, where failing loudly is the point: a slot name
// that does not exist has to stop at the case, not reach a viewer as a shader
// compile error.
function throws(fn) {
    try { fn(); return false; } catch { return true; }
}

function checkClose(name, got, want, detail) {
    check(name, Math.abs(got - want) < TOL, `${detail || ''} got ${got} want ${want}`);
}

function heading(text) {
    console.log('');
    console.log(text);
    console.log('-'.repeat(text.length));
}

// 1. Layout table

function reportLayout(plate) {
    heading('LAYOUT TABLE');
    console.log(
        'level'.padEnd(6) + 'N'.padStart(6) + '  ' + 'h'.padEnd(12) +
        'centers'.padEnd(14) + 'x-faces'.padEnd(14) + 'y-faces'.padEnd(14) +
        'int.faces'.padStart(10)
    );
    for (const row of plate.layoutTable()) {
        console.log(
            String(row.level).padEnd(6) +
            String(row.interior).padStart(6) + '  ' +
            row.spacing.toPrecision(6).padEnd(12) +
            row.center.padEnd(14) +
            row.xFace.padEnd(14) +
            row.yFace.padEnd(14) +
            String(row.interiorFaces).padStart(10)
        );
    }

    console.log('');
    console.log('offsets, center :', Array.from(plate.offsetCenter).join(', '));
    console.log('offsets, x-face :', Array.from(plate.offsetXFace).join(', '));
    console.log('offsets, y-face :', Array.from(plate.offsetYFace).join(', '));
    console.log('');
    console.log(`totals  center ${plate.totalCenter}   x-face ${plate.totalXFace}   y-face ${plate.totalYFace}`);
}

// 2. Offsets are exact prefix sums

function checkOffsets(plate) {
    for (const location of [CENTER, XFACE, YFACE]) {
        const name = LOCATION_NAMES[location].words;
        let running = 0;
        for (let level = 0; level < plate.numLevels; level++) {
            check(
                `offset prefix sum, ${name}, level ${level}`,
                plate.offsetOf(location, level) === running,
                `offset ${plate.offsetOf(location, level)} expected ${running}`
            );
            running += countOf(location, plate.interior[level]);
        }
        const total = [plate.totalCenter, plate.totalXFace, plate.totalYFace][location];
        check(`offset total, ${name}`, total === running, `total ${total} expected ${running}`);
    }

    // Regions tile the buffer with no gap and no overlap. The prefix sums imply
    // it, but it is stated on its own so that added padding fails here.
    for (const location of [CENTER, XFACE, YFACE]) {
        for (let level = 0; level + 1 < plate.numLevels; level++) {
            const end = plate.offsetOf(location, level) + countOf(location, plate.interior[level]);
            check(
                `regions abut, ${LOCATION_NAMES[location].words}, level ${level}`,
                end === plate.offsetOf(location, level + 1)
            );
        }
    }
}

// 3. The controls buffer against its own struct
//
// The host writes this buffer at byte offsets from its slot list, and the
// shader reads it as a struct. A mismatch does not fail; it decodes the wrong
// bytes into a plausible number. Both come from controlsSlotNames, and this
// asserts that they still do.

function checkControlsLayout(plate) {
    const source = makeStructCode(plate);
    const body = source.match(/struct Controls \{([^}]*)\}/);
    check('the Controls struct is emitted', Boolean(body));
    if (!body) return;

    const members = body[1]
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('//'))
        .map((line) => line.split(':')[0].trim());

    check('struct member order matches the export order',
        members.join(',') === plate.controlsSlotNames.join(','),
        `struct [${members.join(', ')}] against export [${plate.controlsSlotNames.join(', ')}]`);

    // Every member is a 4-byte scalar or an array of them, so the offsets must
    // be a plain prefix sum with no padding anywhere.
    let running = 0;
    for (const name of plate.controlsSlotNames) {
        check(`controls offset, ${name}`,
            plate.controlsByteOffset(name) === running,
            `offset ${plate.controlsByteOffset(name)} expected ${running}`);
        running += plate[name].length * 4;
    }
}

// 4. The coefficients buffer, and the two resolvers over it
//
// The same failure and the same guard as the controls buffer, except that every
// slot is a single f32, so the struct is generated from the slot list. This
// asserts the generation, and the two resolvers: a term parameter is a number
// or a slot, and a term that read the wrong one would emit a literal that never
// moves with its slider.

function checkCoefficientsLayout(plate) {
    const source = makeStructCode(plate);
    const body = source.match(/struct Coefficients \{([^}]*)\}/);
    check('the Coefficients struct is emitted', Boolean(body));
    if (!body) return;

    const members = body[1]
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('//'))
        .map((line) => line.split(':')[0].trim());

    check('struct member order matches the slot list',
        members.join(',') === plate.coefficientSlotNames.join(','),
        `struct [${members.join(', ')}] against slots [${plate.coefficientSlotNames.join(', ')}]`);

    check('every slot is f32',
        body[1].split('\n').filter((l) => l.trim()).every((l) => l.includes(': f32,')),
        body[1].trim());

    let running = 0;
    for (const name of plate.coefficientSlotNames) {
        check(`coefficients offset, ${name}`,
            plate.coefficientsByteOffset(name) === running,
            `offset ${plate.coefficientsByteOffset(name)} expected ${running}`);
        running += 4;
    }
    check('the buffer is exactly the slots',
        plate.exportByteOffsetsCoefficients.at(-1) === plate.coefficientSlotNames.length * 4);

    // The two resolvers. A slot reads as a struct member on the emit side and as
    // the plate's current value on the JavaScript side, and a plain number is
    // untouched by either.
    const slotName = plate.coefficientSlotNames[0];
    const slot = coefficientSlot(slotName);
    check('a slot emits a struct member',
        coefficientCodeOf(slot) === `coefficients.${slotName}`, coefficientCodeOf(slot));
    check('a number emits a WGSL literal',
        coefficientCodeOf(7) === '7.0', coefficientCodeOf(7));

    plate.setCoefficients(Object.fromEntries(
        plate.coefficientSlotNames.map((name, index) => [name, index + 1])));
    check('a slot resolves to the plate value',
        coefficientValueOf(plate, slot) === 1, String(coefficientValueOf(plate, slot)));
    check('a number resolves to itself', coefficientValueOf(plate, 0.25) === 0.25);

    // The third form: a slot carrying a shape that varies it in space. The
    // shape multiplies the slot at the point, and a caller with no point to
    // offer gets an error and not a plausible wrong number.
    const doubled = coefficientProfile(slotName, {
        at: (x) => (x > 0.5 ? 2 : 1),
        wgsl: 'select(1.0, 2.0, position.x > 0.5)',
    });
    check('a profile emits the slot times its shape',
        coefficientCodeOf(doubled)
            === `(coefficients.${slotName} * (select(1.0, 2.0, position.x > 0.5)))`,
        coefficientCodeOf(doubled));
    check('a profile resolves to the slot times the shape at the point',
        coefficientValueOf(plate, doubled, { x: 0.75, y: 0.5 }) === 2
        && coefficientValueOf(plate, doubled, { x: 0.25, y: 0.5 }) === 1);
    check('a profile with no position throws rather than returning the base',
        throws(() => coefficientValueOf(plate, doubled)));
    // A profile may also sit on a literal number, for a case whose material
    // varies in space and has no slider. The number is emitted as a literal,
    // and a base that is neither a slot nor a positive number is refused.
    const literalBase = coefficientProfile(0.25, {
        at: (x) => (x > 0.5 ? 4 : 1),
        wgsl: 'select(1.0, 4.0, position.x > 0.5)',
    });
    check('a profile on a literal emits the number times its shape',
        coefficientCodeOf(literalBase) === '(0.25 * (select(1.0, 4.0, position.x > 0.5)))',
        coefficientCodeOf(literalBase));
    check('a profile on a literal resolves to the number times the shape at the point',
        coefficientValueOf(plate, literalBase, { x: 0.75, y: 0.5 }) === 1
        && coefficientValueOf(plate, literalBase, { x: 0.25, y: 0.5 }) === 0.25);
    check('a profile base that is neither a slot nor a positive number throws',
        throws(() => coefficientProfile(0, { at: () => 1, wgsl: '1.0' }))
        && throws(() => coefficientProfile('noSuchSlot', { at: () => 1, wgsl: '1.0' })));
    // The slot holds the smallest value the coefficient takes, so a slider
    // moves the bare material's value.
    check('a shape that falls below one throws',
        throws(() => coefficientProfile(slotName, { at: () => 0.5, wgsl: '0.5' })));
    check('a shape that is not finite throws',
        throws(() => coefficientProfile(slotName, { at: () => NaN, wgsl: '1.0' })));
    check('a profile with no wgsl throws',
        throws(() => coefficientProfile(slotName, { at: () => 1 })));
    check('a profile on an unknown slot throws',
        throws(() => coefficientProfile('notASlot', { at: () => 1, wgsl: '1.0' })));

    // Refused where it is written, not as a shader compile error a viewer meets
    // after choosing a case.
    check('an unknown slot name throws', throws(() => coefficientSlot('notASlot')));
    check('a missing slot value throws', throws(() => plate.setCoefficients({ [slotName]: 1 })));
    check('a non-finite slot value throws', throws(() => plate.setCoefficients(
        Object.fromEntries(plate.coefficientSlotNames.map((name) => [name, NaN])))));
    check('an unknown slot offset throws', throws(() => plate.coefficientsByteOffset('notASlot')));
}

// 5. Fenceposts

function checkFenceposts(plate) {
    for (let level = 0; level < plate.numLevels; level++) {
        const n = plate.interior[level];

        check(`interior is a power of two, level ${level}`, (n & (n - 1)) === 0, `N = ${n}`);

        // N interior cells are spanned by N+1 interior faces.
        check(
            `interior face count, level ${level}`,
            (plate.widthXFace[level] - 2) === n + 1,
            `x-face interior span ${plate.widthXFace[level] - 2}, expected ${n + 1}`
        );
        check(
            `interior face count, y, level ${level}`,
            (plate.heightYFace[level] - 2) === n + 1,
            `y-face interior span ${plate.heightYFace[level] - 2}, expected ${n + 1}`
        );

        // The tangential extent of a face array matches the cell extent.
        check(`x-face tangential extent, level ${level}`, plate.heightXFace[level] === plate.heightCenter[level]);
        check(`y-face tangential extent, level ${level}`, plate.widthYFace[level] === plate.widthCenter[level]);

        // N+1 coarsens to N/2+1.
        if (level + 1 < plate.numLevels) {
            const nCoarse = plate.interior[level + 1];
            check(
                `interior halves, level ${level} -> ${level + 1}`,
                nCoarse * 2 === n,
                `${n} -> ${nCoarse}`
            );
            check(
                `face fencepost coarsens, level ${level} -> ${level + 1}`,
                (nCoarse + 1) === (n + 1 + 1) / 2,
                `${n + 1} -> ${nCoarse + 1}`
            );
        }
    }

    // No array width is a power of two, since every array adds a ghost margin.
    // Asserting it catches code that assumes otherwise.
    for (let level = 0; level < plate.numLevels; level++) {
        const w = plate.widthCenter[level];
        check(
            `array width is deliberately not a power of two, level ${level}`,
            (w & (w - 1)) !== 0,
            `widthCenter = ${w}`
        );
    }
}

// 6. Coarse-fine alignment, checked in physical coordinates

function checkAlignment(plate) {
    for (let level = 0; level + 1 < plate.numLevels; level++) {
        const h = plate.spacing[level];
        const H = plate.spacing[level + 1];
        const nCoarse = plate.interior[level + 1];

        checkClose(`spacing doubles, level ${level}`, H, 2 * h);

        // Centers: the coarse cell sits at the centroid of its four fine cells.
        for (let coarseRow = 1; coarseRow <= nCoarse; coarseRow++) {
            for (let coarseColumn = 1; coarseColumn <= nCoarse; coarseColumn++) {
                const coarse = positionOf(CENTER, coarseColumn, coarseRow, H);
                const fineColumn = 2 * coarseColumn - 1;
                const fineRow = 2 * coarseRow - 1;

                let sx = 0, sy = 0;
                for (let stepRow = 0; stepRow < 2; stepRow++) {
                    for (let stepColumn = 0; stepColumn < 2; stepColumn++) {
                        const p = positionOf(CENTER, fineColumn + stepColumn, fineRow + stepRow, h);
                        sx += p.x; sy += p.y;
                    }
                }
                checkClose(`center centroid x, L${level} (${coarseColumn},${coarseRow})`, sx / 4, coarse.x);
                checkClose(`center centroid y, L${level} (${coarseColumn},${coarseRow})`, sy / 4, coarse.y);
            }
        }

        // x-faces: coincident in x with fine face 2A-1, centroid in y over the
        // two fine rows it spans. A is 1..nCoarse+1, one more than the cells.
        for (let coarseRow = 1; coarseRow <= nCoarse; coarseRow++) {
            for (let coarseColumn = 1; coarseColumn <= nCoarse + 1; coarseColumn++) {
                const coarse = positionOf(XFACE, coarseColumn, coarseRow, H);
                const fineColumn = 2 * coarseColumn - 1;
                const fine = positionOf(XFACE, fineColumn, 2 * coarseRow - 1, h);

                checkClose(`x-face coincident in x, L${level} (${coarseColumn},${coarseRow})`, fine.x, coarse.x);

                const yLow  = positionOf(XFACE, fineColumn, 2 * coarseRow - 1, h).y;
                const yHigh = positionOf(XFACE, fineColumn, 2 * coarseRow,     h).y;
                checkClose(`x-face centroid in y, L${level} (${coarseColumn},${coarseRow})`, (yLow + yHigh) / 2, coarse.y);

                // The coincident fine face must exist in the fine array's
                // interior range, not in its ghost margin.
                check(
                    `x-face partner in interior, L${level} (${coarseColumn},${coarseRow})`,
                    fineColumn >= 1 && fineColumn <= plate.interior[level] + 1,
                    `fine column = ${fineColumn}, interior 1..${plate.interior[level] + 1}`
                );
            }
        }

        // y-faces, mirrored.
        for (let coarseRow = 1; coarseRow <= nCoarse + 1; coarseRow++) {
            for (let coarseColumn = 1; coarseColumn <= nCoarse; coarseColumn++) {
                const coarse = positionOf(YFACE, coarseColumn, coarseRow, H);
                const fineRow = 2 * coarseRow - 1;
                const fine = positionOf(YFACE, 2 * coarseColumn - 1, fineRow, h);

                checkClose(`y-face coincident in y, L${level} (${coarseColumn},${coarseRow})`, fine.y, coarse.y);

                const xLow  = positionOf(YFACE, 2 * coarseColumn - 1, fineRow, h).x;
                const xHigh = positionOf(YFACE, 2 * coarseColumn,     fineRow, h).x;
                checkClose(`y-face centroid in x, L${level} (${coarseColumn},${coarseRow})`, (xLow + xHigh) / 2, coarse.x);

                check(
                    `y-face partner in interior, L${level} (${coarseColumn},${coarseRow})`,
                    fineRow >= 1 && fineRow <= plate.interior[level] + 1,
                    `fine row = ${fineRow}`
                );
            }
        }
    }
}

// 7. The domain boundary sits in the same physical place on every level

function checkBoundaryPosition(plate) {
    for (let level = 0; level < plate.numLevels; level++) {
        const h = plate.spacing[level];
        const n = plate.interior[level];

        checkClose(`left boundary at x = 0, level ${level}`,  positionOf(XFACE, 1, 1, h).x, 0);
        checkClose(`right boundary at x = 1, level ${level}`, positionOf(XFACE, n + 1, 1, h).x, 1);
        checkClose(`top boundary at y = 0, level ${level}`,    positionOf(YFACE, 1, 1, h).y, 0);
        checkClose(`bottom boundary at y = 1, level ${level}`, positionOf(YFACE, 1, n + 1, h).y, 1);

        // First and last interior cell centers sit half a cell inside.
        checkClose(`first cell center, level ${level}`, positionOf(CENTER, 1, 1, h).x, h / 2);
        checkClose(`last cell center, level ${level}`,  positionOf(CENTER, n, n, h).x, 1 - h / 2);

        // Ghost centers sit half a cell outside, which is what makes the
        // Dirichlet fill p_ghost = 2 p_boundary - p_interior second order.
        checkClose(`ghost center outside, level ${level}`, positionOf(CENTER, 0, 1, h).x, -h / 2);
    }
}

// 8. Index helpers are bijective and stay inside their level's region

function checkIndexing(plate) {
    for (const location of [CENTER, XFACE, YFACE]) {
        const name = LOCATION_NAMES[location].words;
        const seen = new Set();

        for (let level = 0; level < plate.numLevels; level++) {
            const w = plate.widthAt(location, level);
            const hgt = plate.heightAt(location, level);
            const base = plate.offsetOf(location, level);
            const size = countOf(location, plate.interior[level]);

            for (let row = 0; row < hgt; row++) {
                for (let column = 0; column < w; column++) {
                    const idx = plate.indexOf(location, level, column, row);
                    if (idx < base || idx >= base + size) {
                        check(`index in region, ${name}, L${level} (${column},${row})`, false,
                            `idx ${idx} outside [${base}, ${base + size})`);
                        return;
                    }
                    if (seen.has(idx)) {
                        check(`index unique, ${name}, L${level} (${column},${row})`, false, `duplicate idx ${idx}`);
                        return;
                    }
                    seen.add(idx);
                }
            }
        }

        const total = [plate.totalCenter, plate.totalXFace, plate.totalYFace][location];
        check(`indexing covers the buffer, ${name}`, seen.size === total,
            `covered ${seen.size} of ${total}`);
    }
}

// 9. Boundary classification

function checkClassification(plate) {
    for (let level = 0; level < plate.numLevels; level++) {
        const n = plate.interior[level];

        // Rectangularity padding, and only that, is INERT.
        for (let row = 0; row < plate.heightXFace[level]; row++) {
            check(`x-face padding inert, L${level} col 0`,
                plate.typeXFace[plate.indexXFace(level, 0, row)] === INERT);
            check(`x-face padding inert, L${level} col ${n + 2}`,
                plate.typeXFace[plate.indexXFace(level, n + 2, row)] === INERT);
        }
        for (let column = 0; column < plate.widthYFace[level]; column++) {
            check(`y-face padding inert, L${level} row 0`,
                plate.typeYFace[plate.indexYFace(level, column, 0)] === INERT);
            check(`y-face padding inert, L${level} row ${n + 2}`,
                plate.typeYFace[plate.indexYFace(level, column, n + 2)] === INERT);
        }

        // Domain boundary faces carry the edge type, never FLUID.
        for (let row = 1; row <= n; row++) {
            check(`left boundary face typed, L${level} row=${row}`,
                plate.typeXFace[plate.indexXFace(level, 1, row)] === plate.edges.left);
            check(`right boundary face typed, L${level} row=${row}`,
                plate.typeXFace[plate.indexXFace(level, n + 1, row)] === plate.edges.right);
        }
        for (let column = 1; column <= n; column++) {
            check(`top boundary face typed, L${level} column=${column}`,
                plate.typeYFace[plate.indexYFace(level, column, 1)] === plate.edges.top);
            check(`bottom boundary face typed, L${level} column=${column}`,
                plate.typeYFace[plate.indexYFace(level, column, n + 1)] === plate.edges.bottom);
        }

        // Tangential ghost rows are not inert: the tangential diffusion stencil
        // reads them, so they carry a type the fill can serve.
        for (let faceColumn = 1; faceColumn <= n + 1; faceColumn++) {
            check(`x-face tangential ghost typed, L${level} column=${faceColumn} row=0`,
                plate.typeXFace[plate.indexXFace(level, faceColumn, 0)] !== INERT &&
                plate.typeXFace[plate.indexXFace(level, faceColumn, 0)] !== FLUID);
            check(`x-face tangential ghost typed, L${level} column=${faceColumn} row=${n + 1}`,
                plate.typeXFace[plate.indexXFace(level, faceColumn, n + 1)] !== INERT &&
                plate.typeXFace[plate.indexXFace(level, faceColumn, n + 1)] !== FLUID);
        }

        // Ghost centers are never FLUID; interior centers away from obstacles
        // are.
        for (let column = 0; column < plate.widthCenter[level]; column++) {
            check(`ghost center not fluid, L${level} column=${column}`,
                plate.typeCenter[plate.indexCenter(level, column, 0)] !== FLUID &&
                plate.typeCenter[plate.indexCenter(level, column, n + 1)] !== FLUID);
        }

        // Consistency: an internal face between two fluid cells is FLUID.
        let mismatches = 0;
        for (let row = 1; row <= n; row++) {
            for (let faceColumn = 1; faceColumn <= n + 1; faceColumn++) {
                const tm = plate.typeCenter[plate.indexCenter(level, faceColumn - 1, row)];
                const tp = plate.typeCenter[plate.indexCenter(level, faceColumn, row)];
                const tf = plate.typeXFace[plate.indexXFace(level, faceColumn, row)];
                const expected = combineFaceType(tm, tp);
                if (tf !== expected) mismatches++;
            }
        }
        check(`x-face types agree with the cell rule, L${level}`, mismatches === 0,
            `${mismatches} mismatched faces`);
    }
}

function reportClassification(plate) {
    heading('CLASSIFICATION COUNTS, FINEST LEVEL');
    const level = 0;

    const tally = (typeArray, location) => {
        const counts = new Array(BOUNDARY_NAMES.length).fill(0);
        const w = plate.widthAt(location, level);
        const hgt = plate.heightAt(location, level);
        for (let row = 0; row < hgt; row++) {
            for (let column = 0; column < w; column++) {
                counts[typeArray[plate.indexOf(location, level, column, row)]]++;
            }
        }
        return counts;
    };

    const rows = [
        ['centers', tally(plate.typeCenter, CENTER)],
        ['x-faces', tally(plate.typeXFace, XFACE)],
        ['y-faces', tally(plate.typeYFace, YFACE)],
    ];

    console.log('        ' + BOUNDARY_NAMES.map((n) => n.padStart(9)).join(''));
    for (const [name, counts] of rows) {
        console.log(name.padEnd(8) + counts.map((c) => String(c).padStart(9)).join(''));
    }
}

// 10. Memory budget

function reportMemory(finestIndex) {
    const plate = new Plate(finestIndex);
    addGeometry(plate, { edges: { left: INLET, right: OUTLET, top: WALL, bottom: WALL } });

    heading(`STORAGE BUDGET, finest interior ${plate.interior[0]}`);

    let grand = 0;
    let overLimit = false;

    for (const group of BUFFER_GROUPS) {
        const arrays = plate.arraysInGroup(group);
        const bytes = plate.bufferBytes(group.name);
        grand += bytes;
        const mib = bytes / (1024 * 1024);
        const headroom = (MAX_STORAGE_BINDING_BYTES - bytes) / (1024 * 1024);
        const flag = bytes > MAX_STORAGE_BINDING_BYTES ? '  OVER 128 MiB LIMIT' : '';
        if (bytes > MAX_STORAGE_BINDING_BYTES) overLimit = true;
        console.log(
            `  ${group.name.padEnd(17)} ${String(arrays.length).padStart(3)} arrays  ` +
            `${mib.toFixed(1).padStart(8)} MiB   headroom ${headroom.toFixed(1).padStart(8)} MiB${flag}`
        );
    }

    const layoutBytes = plate.exportByteOffsetsLayout[plate.exportByteOffsetsLayout.length - 1];
    grand += layoutBytes;
    console.log(`  ${'layout'.padEnd(17)} ${String(plate.exportLayout.length).padStart(3)} arrays  ` +
        `${(layoutBytes / (1024 * 1024)).toFixed(1).padStart(8)} MiB`);
    console.log(`  ${'TOTAL'.padEnd(17)}             ${(grand / (1024 * 1024)).toFixed(1).padStart(8)} MiB`);

    return { plate, overLimit };
}

// Main

function main() {
    console.log('STORAGE LAYOUT');
    console.log('The power of two is the interior cell count; every array adds a ghost margin.');

    // A plate with four walls and two circular obstacles.
    const finestIndex = 2; // MESH_SIZES[2] = 256
    const plate = new Plate(finestIndex);
    addGeometry(plate, { edges: { left: WALL, right: WALL, top: WALL, bottom: WALL }, solids: [
        { kind: 'circle', centerX: 0.30, centerY: 0.50, radius: 0.10, type: WALL },
        { kind: 'circle', centerX: 0.70, centerY: 0.50, radius: 0.10, type: WALL },
    ] });

    reportLayout(plate);

    heading('FIELD REGISTRY');
    const arrays = expandFieldSpec(FIELD_SPEC);
    for (const loc of [CENTER, XFACE, YFACE]) {
        const names = arrays.filter((a) => a.location === loc).map((a) => a.name);
        console.log(`  ${LOCATION_NAMES[loc].words.padEnd(8)} ${names.length} arrays: ${names.join(', ')}`);
    }

    reportClassification(plate);

    heading('CHECKS');
    checkOffsets(plate);
    checkControlsLayout(plate);
    checkCoefficientsLayout(plate);
    checkFenceposts(plate);
    checkAlignment(plate);
    checkBoundaryPosition(plate);
    checkIndexing(plate);
    checkClassification(plate);

    // The same checks on a configuration with an outlet and with no obstacles,
    // so that a rule which only works for all-wall is caught.
    const plain = new Plate(finestIndex);
    addGeometry(plain, { edges: { left: INLET, right: OUTLET, top: WALL, bottom: SYMMETRY } });
    checkOffsets(plain);
    checkFenceposts(plain);
    checkAlignment(plain);
    checkBoundaryPosition(plain);
    checkClassification(plain);

    // And at the finest mesh, so nothing depends on the level count.
    const big = new Plate(0);
    checkOffsets(big);
    checkFenceposts(big);
    checkAlignment(big);
    checkBoundaryPosition(big);

    console.log(`  ${passCount} checks passed.`);
    if (failures.length) {
        console.log(`  ${failures.length} FAILED:`);
        for (const f of failures.slice(0, 40)) console.log(`    ${f}`);
        if (failures.length > 40) console.log(`    ... and ${failures.length - 40} more`);
    }

    const small = reportMemory(2);
    const large = reportMemory(0);

    heading('RESULT');
    if (failures.length === 0) {
        console.log('All layout checks passed.');
    } else {
        console.log(`${failures.length} checks FAILED.`);
    }
    if (large.overLimit) {
        console.log('This plate gives every field a multigrid workspace, which at 1024');
        console.log('exceeds the default 128 MiB binding limit. The page gives one only to');
        console.log('the fields a case solves; verify_storage.js checks every case fits.');
    }

    process.exitCode = failures.length === 0 ? 0 : 1;
}

main();
});
