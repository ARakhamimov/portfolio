// verify_geometry.js, by Allen Rakhamimov.
// What the geometry's shapes do to the classification arrays.
//
// No solver. This checks what a rect, a fill and a circle given to addGeometry
// do to the classification arrays. A primitive that does nothing is the failure to guard
// against, since a case with no obstacles still runs and still looks like a
// plausible flow. Extents are checked against physical positions, for the
// reason verify_layout.js gives.
//
// Three rules a case author relies on are asserted: a later shape overwrites an
// earlier one; a small circle survives on coarse levels while a thin rectangle
// does not; and a passage narrower than a coarse cell closes on that level and
// leaves it no path from inlet to outlet.

// verify.html loads it, then runs the body it registers.
verifyCheck('verify_geometry.js', function (process) {
'use strict';

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

// Helpers

// Interior centers only. The ghost ring carries the domain edge types, and no
// obstacle primitive may touch it.
function eachInteriorCenter(plate, level, visit) {
    const n = plate.interior[level];
    const h = plate.spacing[level];
    for (let row = 1; row <= n; row++) {
        for (let column = 1; column <= n; column++) {
            visit(column, row, positionOf(CENTER, column, row, h));
        }
    }
}

// The same inclusive test classifyCenters applies, written out here, so a
// change to one side has to be made on the other deliberately.
function insideRect(p, r) {
    return p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
}

function countInterior(plate, level, type) {
    let count = 0;
    eachInteriorCenter(plate, level, (column, row) => {
        if (plate.typeCenter[plate.indexCenter(level, column, row)] === type) count++;
    });
    return count;
}

function countPredicate(plate, level, predicate) {
    let count = 0;
    eachInteriorCenter(plate, level, (column, row, p) => { if (predicate(p)) count++; });
    return count;
}

function sameCenterMap(a, b) {
    if (a.typeCenter.length !== b.typeCenter.length) return false;
    for (let k = 0; k < a.typeCenter.length; k++) {
        if (a.typeCenter[k] !== b.typeCenter[k]) return false;
    }
    return true;
}

// Flood fill over fluid interior centers from the column beside the inlet ghost
// to the column beside the outlet ghost. A carved passage has to keep this on
// every level: a level with no path from inlet to outlet has nothing useful to
// correct the finer level with.
function connectsInletToOutlet(plate, level) {
    const n = plate.interior[level];
    const seen = new Uint8Array((n + 2) * (n + 2));
    const flat = (column, row) => column + row * (n + 2);
    const stack = [];

    for (let row = 1; row <= n; row++) {
        if (plate.typeCenter[plate.indexCenter(level, 1, row)] !== FLUID) continue;
        seen[flat(1, row)] = 1;
        stack.push([1, row]);
    }

    while (stack.length) {
        const [column, row] = stack.pop();
        if (column === n) return true;
        for (const [stepColumn, stepRow] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nextColumn = column + stepColumn;
            const nextRow = row + stepRow;
            if (nextColumn < 1 || nextColumn > n || nextRow < 1 || nextRow > n) continue;
            if (seen[flat(nextColumn, nextRow)]) continue;
            if (plate.typeCenter[plate.indexCenter(level, nextColumn, nextRow)] !== FLUID) continue;
            seen[flat(nextColumn, nextRow)] = 1;
            stack.push([nextColumn, nextRow]);
        }
    }
    return false;
}

// 1. A rectangle marks exactly the cells its position test selects, on every
// level, and at least one
//
// Per level, since shapes are marked from the geometry on every level and not
// restricted from the fine mask.

const RECT = { x0: 0.30, y0: 0.20, x1: 0.55, y1: 0.70 };

function checkRectExtent(plate, rect, label) {
    for (let level = 0; level < plate.numLevels; level++) {
        let marked = 0;
        let wrongInside = 0;
        let wrongOutside = 0;

        eachInteriorCenter(plate, level, (column, row, p) => {
            const type = plate.typeCenter[plate.indexCenter(level, column, row)];
            if (insideRect(p, rect)) {
                marked++;
                if (type !== WALL) wrongInside++;
            } else if (type !== FLUID) {
                wrongOutside++;
            }
        });

        check(`${label}: rect covers its predicate, L${level}`, wrongInside === 0,
            `${wrongInside} cells inside the rectangle are not WALL`);
        check(`${label}: rect marks nothing else, L${level}`, wrongOutside === 0,
            `${wrongOutside} cells outside the rectangle are not FLUID`);
        check(`${label}: rect is non-empty, L${level}`, marked > 0,
            'the rectangle marked no cells at all');
    }
}

// 2. The primitive is not inert
//
// The fluid count before and after, against the count the position test
// predicts. A primitive that never reclassifies leaves the difference at zero.

function checkRectChangesTheMap(finestIndex, rect) {
    const plate = new Plate(finestIndex);
    const edges = { left: INLET, right: OUTLET, top: WALL, bottom: WALL };
    addGeometry(plate, { edges });

    const before = [];
    for (let level = 0; level < plate.numLevels; level++) before.push(countInterior(plate, level, FLUID));

    addGeometry(plate, { edges, solids: [{ kind: 'rect', ...rect, type: WALL }] });

    const rows = [];
    for (let level = 0; level < plate.numLevels; level++) {
        const after = countInterior(plate, level, FLUID);
        const predicted = countPredicate(plate, level, (p) => insideRect(p, rect));
        rows.push({ level, n: plate.interior[level], before: before[level], after, predicted });

        check(`a rect changes the classification, L${level}`, after < before[level],
            `fluid count unchanged at ${after}; the rect is inert on this level`);
        check(`a rect converts exactly its own cells, L${level}`,
            before[level] - after === predicted,
            `converted ${before[level] - after}, predicted ${predicted}`);
    }
    return { plate, rows };
}

// 3. Corner order does not matter

function checkCornerOrder(finestIndex, rect) {
    const straight = new Plate(finestIndex);
    addGeometry(straight, { solids: [{ kind: 'rect', x0: rect.x0, y0: rect.y0, x1: rect.x1, y1: rect.y1, type: WALL }] });

    const swapped = new Plate(finestIndex);
    addGeometry(swapped, { solids: [{ kind: 'rect', x0: rect.x1, y0: rect.y1, x1: rect.x0, y1: rect.y0, type: WALL }] });

    check('a rect normalizes its corners', sameCenterMap(straight, swapped),
        'the two orderings give different center maps');
}

// 4. Declaration order, and the carve
//
// The maze is a solid fill with fluid rectangles carved back out of it, and
// nothing special-cases the carve: a later shape overwrites an earlier one. The
// reverse order is checked too, since "overwrites" means something only if the
// other order gives the other answer.

function checkCarve(finestIndex, rect) {
    const carved = new Plate(finestIndex);
    addGeometry(carved, { edges: { left: INLET, right: OUTLET, top: WALL, bottom: WALL },
        solids: [{ kind: 'fill', type: WALL }, { kind: 'rect', ...rect, type: FLUID }] });

    for (let level = 0; level < carved.numLevels; level++) {
        let wrong = 0;
        eachInteriorCenter(carved, level, (column, row, p) => {
            const type = carved.typeCenter[carved.indexCenter(level, column, row)];
            const want = insideRect(p, rect) ? FLUID : WALL;
            if (type !== want) wrong++;
        });
        check(`carve leaves exactly the rectangle fluid, L${level}`, wrong === 0,
            `${wrong} cells disagree`);
    }

    // Reversed: the fill lands last and there is no fluid left anywhere.
    const buried = new Plate(finestIndex);
    addGeometry(buried, { solids: [{ kind: 'rect', ...rect, type: FLUID }, { kind: 'fill', type: WALL }] });
    for (let level = 0; level < buried.numLevels; level++) {
        check(`a later fill buries an earlier rect, L${level}`,
            countInterior(buried, level, FLUID) === 0,
            `${countInterior(buried, level, FLUID)} fluid cells survived the fill`);
    }

    // The ghost ring belongs to the domain's edges, and no obstacle may
    // overwrite it.
    for (let level = 0; level < carved.numLevels; level++) {
        const n = carved.interior[level];
        let wrong = 0;
        for (let row = 1; row <= n; row++) {
            if (carved.typeCenter[carved.indexCenter(level, 0, row)] !== INLET) wrong++;
            if (carved.typeCenter[carved.indexCenter(level, n + 1, row)] !== OUTLET) wrong++;
        }
        check(`a fill leaves the ghost ring alone, L${level}`, wrong === 0,
            `${wrong} ghost centers were overwritten`);
    }

    return carved;
}

// 5. Faces follow the centers
//
// rebuildClassification marks the centers, then derives the faces from the
// finished center map. A rebuild that skipped the faces would leave a carved
// passage with the face types of the solid block it was cut from, and the
// solver would run against that mask without complaint.

function checkFacesFollow(plate, label) {
    for (let level = 0; level < plate.numLevels; level++) {
        const n = plate.interior[level];
        let mismatchX = 0;
        let mismatchY = 0;

        for (let row = 1; row <= n; row++) {
            for (let faceColumn = 1; faceColumn <= n + 1; faceColumn++) {
                const want = combineFaceType(
                    plate.typeCenter[plate.indexCenter(level, faceColumn - 1, row)],
                    plate.typeCenter[plate.indexCenter(level, faceColumn, row)]
                );
                if (plate.typeXFace[plate.indexXFace(level, faceColumn, row)] !== want) mismatchX++;
            }
        }
        for (let faceRow = 1; faceRow <= n + 1; faceRow++) {
            for (let column = 1; column <= n; column++) {
                const want = combineFaceType(
                    plate.typeCenter[plate.indexCenter(level, column, faceRow - 1)],
                    plate.typeCenter[plate.indexCenter(level, column, faceRow)]
                );
                if (plate.typeYFace[plate.indexYFace(level, column, faceRow)] !== want) mismatchY++;
            }
        }

        check(`${label}: x-faces follow the carved centers, L${level}`, mismatchX === 0,
            `${mismatchX} faces stale`);
        check(`${label}: y-faces follow the carved centers, L${level}`, mismatchY === 0,
            `${mismatchY} faces stale`);
    }
}

// 6. Small features: a circle survives, a rectangle does not
//
// A circle smaller than a coarse cell is kept alive, so it does not
// vanish with its boundary condition. Doing the same for a rectangle would
// widen a carved passage, so a thin rectangle is allowed to disappear. Both
// halves are asserted.
//
// The rectangle is placed between two coarse cell centers, so whether it
// disappears depends on where it lands as well as on its width: a plate thinner
// than a coarse cell is absent on that level, not coarsely drawn.

function checkSmallFeatures(finestIndex) {
    const probe = new Plate(finestIndex);
    const coarsest = probe.coarsestLevel;
    const coarseSpacing = probe.spacing[coarsest];
    const fine = 0;

    // Radius well under a coarse cell.
    const circle = new Plate(finestIndex);
    addGeometry(circle, { solids: [{ kind: 'circle', centerX: 0.5, centerY: 0.5, radius: coarseSpacing * 0.3, type: WALL }] });

    // Same thickness, placed so that no coarse center falls inside it. Coarse
    // centers sit at (k - 0.5) * h, so the band between two of them is empty.
    const midpoint = 0.5;
    const halfWidth = coarseSpacing * 0.15;
    const plate = new Plate(finestIndex);
    addGeometry(plate, { solids: [{ kind: 'rect', x0: 0.2, y0: midpoint - halfWidth, x1: 0.8, y1: midpoint + halfWidth,
        type: WALL }] });

    const circleFine = countInterior(circle, fine, WALL);
    const circleCoarse = countInterior(circle, coarsest, WALL);
    const rectFine = countInterior(plate, fine, WALL);
    const rectCoarse = countInterior(plate, coarsest, WALL);

    check('a sub-coarse-cell circle exists on the finest level', circleFine > 0);
    check('a sub-coarse-cell circle SURVIVES on the coarsest level', circleCoarse > 0,
        'the circle lost its small-feature preservation');
    check('a thin rectangle exists on the finest level', rectFine > 0);
    check('a thin rectangle VANISHES on the coarsest level', rectCoarse === 0,
        `${rectCoarse} cells survived; rectangles are documented as having no ` +
        'small-feature preservation, and preserving one would widen a carved passage');

    return { coarsest, coarseSpacing, circleFine, circleCoarse, rectFine, rectCoarse };
}

// 7. A carved passage, and the width it needs
//
// The rule for case authors is two cells on the coarsest level. A passage wider
// than that connects inlet to outlet on every level, and one narrower than a
// coarse cell closes on the coarsest.

function checkPassage(finestIndex) {
    const probe = new Plate(finestIndex);
    const coarsest = probe.coarsestLevel;
    const h = probe.spacing[coarsest];

    const build = (y0, y1) => {
        const plate = new Plate(finestIndex);
        // Past both edges on purpose: the passage has to reach the inlet and
        // the outlet, and a rectangle stopping at x = 0 stops half a cell
        // short.
        addGeometry(plate, { edges: { left: INLET, right: OUTLET, top: WALL, bottom: WALL },
            solids: [{ kind: 'fill', type: WALL }, { kind: 'rect', x0: -1, y0, x1: 2, y1, type: FLUID }] });
        return plate;
    };

    // Wide: spans at least two coarse centers wherever it is placed.
    const wide = build(0.25, 0.25 + 2.5 * h);
    // Narrow: sits between two coarse centers.
    const narrowMid = 0.5;
    const narrow = build(narrowMid - 0.15 * h, narrowMid + 0.15 * h);

    const rows = [];
    for (let level = 0; level < wide.numLevels; level++) {
        const wideOpen = connectsInletToOutlet(wide, level);
        const narrowOpen = connectsInletToOutlet(narrow, level);
        rows.push({ level, n: wide.interior[level], wideOpen, narrowOpen });
        check(`a passage over two coarse cells stays open, L${level}`, wideOpen,
            'no path from inlet to outlet');
    }

    check('a sub-coarse-cell passage is open on the finest level',
        connectsInletToOutlet(narrow, 0));
    check('a sub-coarse-cell passage CLOSES on the coarsest level',
        !connectsInletToOutlet(narrow, coarsest),
        'the narrow passage survived coarsening, so the stated authoring rule is ' +
        'measuring something other than what closes a passage');

    return rows;
}

// Main

function main() {
    console.log('GEOMETRY PRIMITIVES VERIFICATION');
    console.log('A rect, a fill and the carve, against physical positions.');

    const finestIndex = 2; // MESH_SIZES[2] = 256

    heading('RECTANGLE, PER LEVEL');
    const { plate, rows } = checkRectChangesTheMap(finestIndex, RECT);
    console.log('level'.padEnd(6) + 'N'.padStart(6) + 'fluid before'.padStart(14) +
        'fluid after'.padStart(13) + 'predicted'.padStart(11) + 'converted'.padStart(11));
    for (const row of rows) {
        console.log(
            String(row.level).padEnd(6) + String(row.n).padStart(6) +
            String(row.before).padStart(14) + String(row.after).padStart(13) +
            String(row.predicted).padStart(11) + String(row.before - row.after).padStart(11)
        );
    }

    checkRectExtent(plate, RECT, 'plain');
    checkFacesFollow(plate, 'plain');
    checkCornerOrder(finestIndex, RECT);

    const carved = checkCarve(finestIndex, RECT);
    checkFacesFollow(carved, 'carved');

    heading('SMALL FEATURES AT THE COARSEST LEVEL');
    const small = checkSmallFeatures(finestIndex);
    console.log(`coarsest level ${small.coarsest}, h ${small.coarseSpacing.toPrecision(4)}`);
    console.log(`  circle, r = 0.30 h    finest ${String(small.circleFine).padStart(5)} cells   ` +
        `coarsest ${String(small.circleCoarse).padStart(3)} cells   survives`);
    console.log(`  rect,   t = 0.30 h    finest ${String(small.rectFine).padStart(5)} cells   ` +
        `coarsest ${String(small.rectCoarse).padStart(3)} cells   vanishes`);

    heading('CARVED PASSAGE, INLET TO OUTLET');
    const passage = checkPassage(finestIndex);
    console.log('level'.padEnd(6) + 'N'.padStart(6) + '  2.5 coarse cells'.padEnd(20) +
        '0.3 coarse cells');
    for (const row of passage) {
        console.log(
            String(row.level).padEnd(6) + String(row.n).padStart(6) + '  ' +
            (row.wideOpen ? 'open' : 'CLOSED').padEnd(20) +
            (row.narrowOpen ? 'open' : 'closed')
        );
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
