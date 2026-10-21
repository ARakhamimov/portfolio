// verify_sandbox.js, by Allen Rakhamimov.
// The sandbox's ports, shapes, paint and refusals.
//
// The sandbox lets a viewer place inlets and outlets anywhere along the edges,
// solid shapes anywhere inside, and paint catalyst and porous medium. All of it
// is data: a port is a stretch of the ghost ring retyped by classification plus
// five coefficient slots, a shape is classification, and a painted region is an
// array in the grid buffer, so nothing a viewer does changes the shader. The
// sandbox is found among the presets by its category, not by id.
//
//   1. Ports mark the ghost ring, at every level, with their own type.
//   2. The generated shader is byte-identical across layouts: ports moved and
//      retyped, shapes added and carved, a second inlet.
//   3. The refusals fire where they should and only there.
//   4. A capsule marks exactly the cells within its radius of its segment, and
//      a capsule of zero length is a circle.
//   5. An edit applied to a plate already classified for another layout gives
//      exactly the plate built fresh for the new one, at every level, which is
//      how the editor applies an edit without a rebuild.
//   6. The editor's arithmetic: snapping, the shape a drag draws, where a new
//      port goes, which edits need a re-mark, the layout's life across a
//      resolution change and a case change, and the panel's speed.
//   7. Painted regions: each painted array marked at its own points on every
//      level, against an independent statement of the region; the overlap
//      rule and bare; a brush stroke marking what its segments' capsules do; a
//      pellet's core and shell; the species and momentum rows reading the paint
//      in the generated WGSL; and the refusals of the painted form.
//   8. A saved case: plain data that reads back to itself, an id that steps
//      around one in use, registered as the sandbox with the saved layout,
//      reaction and sliders, and the files and layouts it refuses.
//
// Not checked: no WGSL runs here, so the boundary fill a port produces is not
// exercised, and the page's editor itself, which is DOM and pointer handling,
// is not touched; section 6 checks the functions it calls.

// verify.html loads it, then runs the body it registers.
verifyCheck('verify_sandbox.js', function (process) {
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

// A section that raises is recorded as a failure and the run carries on, so
// the verdict below is always printed.
function section(title, body) {
    heading(title);
    try {
        body();
    } catch (error) {
        failures.push(`${title}: raised ${error.message}`);
        console.log(`  raised: ${error.message}`);
    }
}

const sandbox = casePresets().find((p) => p.category === 'sandbox');

// A layout is the sandbox with its ports, shapes and edges replaced.
function layout(changes) {
    return { ...sandbox, geometry: { ...sandbox.geometry, ...changes } };
}

// The plate the app builds for a layout, at a mesh small enough to sweep.
function plateFor(preset, finestIndex = MESH_SIZES.indexOf(64)) {
    const plate = new Plate(finestIndex, preset.solver.coarsestCells);
    caseGeometry(plate, preset);
    plate.allocateFields();
    const all = {};
    for (const name of COEFFICIENT_SLOTS) all[name] = 0;
    plate.setCoefficients({ ...all, ...casePortSlotValues(preset.geometry.ports) });
    return plate;
}

const EDGES = ['left', 'top', 'right', 'bottom'];

// Which edge a ghost center is on, or null for an interior cell or a corner.
function edgeOfGhost(plate, level, column, row) {
    const w = plate.widthCenter[level];
    const h = plate.heightCenter[level];
    const onX = column === 0 ? 'left' : column === w - 1 ? 'right' : null;
    const onY = row === 0 ? 'top' : row === h - 1 ? 'bottom' : null;
    if (onX && onY) return null;
    return onX || onY;
}

// Where a ghost center lies along its own edge, 0 to 1.
function alongEdge(plate, level, column, row, edge) {
    const p = positionOf(CENTER, column, row, plate.spacing[level]);
    return edge === 'left' || edge === 'right' ? p.y : p.x;
}

section('1. PORTS MARK THE GHOST RING, AT EVERY LEVEL', () => {
    const preset = sandbox;
    const plate = plateFor(preset);
    let marked = 0;
    for (let level = 0; level < plate.numLevels; level++) {
        for (let row = 0; row < plate.heightCenter[level]; row++) {
            for (let column = 0; column < plate.widthCenter[level]; column++) {
                const edge = edgeOfGhost(plate, level, column, row);
                if (!edge) continue;
                const t = alongEdge(plate, level, column, row, edge);
                const port = preset.geometry.ports.find((q) => q.edge === edge && t >= q.from && t <= q.to);
                const expected = port ? port.type : preset.geometry.edges[edge];
                const actual = plate.typeCenter[plate.indexCenter(level, column, row)];
                if (actual !== expected) {
                    check(`level ${level}, ${edge} ghost at ${t.toFixed(3)} carries its port's type`,
                        false, `expected ${expected}, found ${actual}`);
                    return;
                }
                marked++;
            }
        }
    }
    check('every ghost center typed by its port or its edge', marked > 0);
    console.log(`  ${marked} ghost centers across ${plate.numLevels} levels, each typed by its port or edge`);
});

section('2. THE SHADER IS THE SAME FOR EVERY LAYOUT', () => {
    appSelectPreset(sandbox.id);
    const sourceOf = (preset) => {
        const plate = new Plate(MESH_SIZES.indexOf(preset.solver.cells), preset.solver.coarsestCells);
        caseGeometry(plate, preset);
        return buildSimulationSource(plate, appSystem(), physicsBoundaryTable(preset), 8, appActivePreset().display);
    };
    const reference = sourceOf(sandbox);
    const variants = {
        'ports moved and retyped': layout({ ports: [
            { edge: 'top', from: 0.1, to: 0.4, type: INLET, speed: 0.2, feedA: 0.5, feedB: 0.5 },
            { edge: 'bottom', from: 0.5, to: 0.9, type: OUTLET },
            { edge: 'left', from: 0, to: 1, type: SYMMETRY },
        ] }),
        'shapes placed and carved': layout({ shapes: [
            { kind: 'box', x0: 0.4, y0: 0.2, x1: 0.8, y1: 0.8, solid: true },
            { kind: 'capsule', x0: 0.4, y0: 0.5, x1: 0.8, y1: 0.5, radius: 0.08, solid: false },
            { kind: 'circle', x: 0.25, y: 0.3, radius: 0.1, solid: true },
        ] }),
        'six ports': layout({ ports: [0, 1, 2, 3, 4, 5].map((k) => ({
            edge: EDGES[k % 4], from: k < 4 ? 0 : 0.6, to: k < 4 ? 0.4 : 1,
            type: k === 2 ? OUTLET : INLET, speed: 0.1 * (k + 1), feedA: 1, feedB: 0 })) }),
        'every port removed': layout({ ports: [] }),
        'slip edges': layout({ edges: { left: WALL, right: WALL, top: SYMMETRY, bottom: SYMMETRY } }),
        'regions painted, a stroke, a pellet': layout({ shapes: [
            { kind: 'circle', x: 0.6, y: 0.4, radius: 0.15, paint: 'catalyst', strength: 4 },
            { kind: 'box', x0: 0.5, y0: 0.5, x1: 0.9, y1: 0.9, paint: 'porous', strength: 2 },
            { kind: 'stroke', points: [{ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.2 }, { x: 0.4, y: 0.1 }],
              radius: 0.04, solid: true },
            { kind: 'pellet', x: 0.75, y: 0.25, radius: 0.1, shell: 0.03, strength: 8 },
            { kind: 'capsule', x0: 0.5, y0: 0.6, x1: 0.8, y1: 0.6, radius: 0.04, paint: 'bare', strength: 0 },
        ] }),
    };
    for (const [name, preset] of Object.entries(variants)) {
        const source = sourceOf(preset);
        check(`${name}: byte-identical`, source === reference,
            `${source.length} characters against ${reference.length}`);
    }
    for (let k = 0; k < boundaryPortCount(); k++) {
        check(`the shader reads port ${k}`, reference.includes(`coefficients.portSpeed${k}`)
            && reference.includes(`coefficients.portStart${k}`));
    }
    console.log(`  ${Object.keys(variants).length} layouts against the default, `
        + `${reference.length} characters each`);

    // Again with a reaction chosen, so the catalyst's array is read too.
    const reacting = casePresets().find((p) => p.caseId === sandbox.caseId
        && p.reaction === 'massAction');
    appSelectPreset(reacting.id);
    const reactingSource = sourceOf(reacting);
    check('a reacting sandbox reads the catalyst array', reactingSource.includes('grid.paintCatalystCenter[p]'));
    check('every sandbox reads the porous arrays', reference.includes('grid.paintPorousXFace[p]')
        && reference.includes('grid.paintPorousYFace[p]'));
    check('painted, reacting: byte-identical',
        sourceOf({ ...reacting, geometry: { ...reacting.geometry,
            shapes: variants['regions painted, a stroke, a pellet'].shapes } }) === reactingSource);
    appSelectPreset(sandbox.id);
});

section('3. THE REFUSALS', () => {
    let refusals = 0, acceptances = 0;
    const accepted = (preset) => { acceptances++; return sandboxProblems(preset); };
    const refused = (name, preset, pattern) => {
        const problems = sandboxProblems(preset);
        refusals++;
        check(`refused: ${name}`, problems.some((p) => pattern.test(p)),
            problems.length ? problems.join(' / ') : 'nothing refused');
    };
    check('the default layout is accepted', accepted(sandbox).length === 0, accepted(sandbox).join(' / '));
    const least = 2 / sandbox.solver.coarsestCells;
    const inlet = (edge, from, to) => ({ edge, from, to, type: INLET, speed: 0.5, feedA: 1, feedB: 0 });
    const outlet = { edge: 'right', from: 0, to: 1, type: OUTLET };
    refused('a port shorter than two coarsest cells',
        layout({ ports: [inlet('left', 0.4, 0.4 + 0.9 * least), outlet] }), /shortest/);
    check('a port exactly two coarsest cells long is accepted',
        accepted(layout({ ports: [inlet('left', 0.4, 0.4 + least), outlet] })).length === 0);
    refused('two ports overlapping on one edge',
        layout({ ports: [inlet('left', 0, 0.6), inlet('left', 0.5, 1), outlet] }), /overlaps/);
    check('two ports meeting end to end are accepted',
        accepted(layout({ ports: [inlet('left', 0, 0.5), inlet('left', 0.5, 1), outlet] })).length === 0);
    refused('an inlet with no outlet', layout({ ports: [inlet('left', 0, 1)] }), /add an outlet/);
    refused('a circle narrower than two coarsest cells',
        layout({ shapes: [{ kind: 'circle', x: 0.5, y: 0.5, radius: 0.45 * least, solid: true }] }), /narrower/);
    refused('a capsule narrower than two coarsest cells',
        layout({ shapes: [{ kind: 'capsule', x0: 0.2, y0: 0.5, x1: 0.8, y1: 0.5,
            radius: 0.45 * least, solid: false }] }), /narrower/);
    refused('a wall cutting the inlet off from the outlet',
        layout({ shapes: [{ kind: 'box', x0: 0.45, y0: 0, x1: 0.55, y1: 1, solid: true }] }), /no path/);
    const cut = sandboxProblems(layout({ shapes: [
        { kind: 'box', x0: 0.45, y0: 0, x1: 0.55, y1: 1, solid: true }] }));
    check('two inlets on one edge are named apart', cut.length === 2 && cut[0] !== cut[1]
        && /from 0 to 0\.5/.test(cut[0]), cut.join(' / '));
    check('a wall with a gap two coarse cells wide is accepted',
        accepted(layout({ shapes: [
            { kind: 'box', x0: 0.45, y0: 0, x1: 0.55, y1: 0.45, solid: true },
            { kind: 'box', x0: 0.45, y0: 0.45 + least + 1e-6, x1: 0.55, y1: 1, solid: true },
        ] })).length === 0);
    check('a sealed pocket with no inlet in it is accepted',
        accepted(layout({ shapes: [
            { kind: 'box', x0: 0.5, y0: 0.2, x1: 0.9, y1: 0.8, solid: true },
            { kind: 'box', x0: 0.6, y0: 0.35, x1: 0.8, y1: 0.65, solid: false },
        ] })).length === 0);
    check('an inlet blocked solid along its whole length is accepted',
        accepted(layout({ shapes: [{ kind: 'box', x0: 0, y0: 0, x1: 0.1, y1: 0.5, solid: true }] })).length === 0);
    // The default layout is asked twice, once for the verdict and once for the
    // message, so it is counted once.
    console.log(`  ${refusals} layouts refused for their own reason, ${acceptances - 1} accepted`);
});

section('4. A CAPSULE MARKS ITS CELLS, AND A POINT CAPSULE IS A CIRCLE', () => {
    const level = 0;
    const capsule = { x0: 0.2, y0: 0.3, x1: 0.7, y1: 0.6, radius: 0.09 };
    const plate = new Plate(MESH_SIZES.indexOf(64), 32);
    addGeometry(plate, { solids: [{ kind: 'capsule', ...capsule, type: WALL }] });
    const n = plate.interior[level];
    let mismatched = 0, solid = 0;
    for (let row = 1; row <= n; row++) {
        for (let column = 1; column <= n; column++) {
            const p = positionOf(CENTER, column, row, plate.spacing[level]);
            // Written apart from geometry.js's, as the distance to the nearest of
            // a fine sampling of the segment.
            let best = Infinity;
            for (let s = 0; s <= 2000; s++) {
                const x = capsule.x0 + (capsule.x1 - capsule.x0) * s / 2000;
                const y = capsule.y0 + (capsule.y1 - capsule.y0) * s / 2000;
                best = Math.min(best, Math.hypot(p.x - x, p.y - y));
            }
            const inside = best <= capsule.radius;
            const marked = plate.typeCenter[plate.indexCenter(level, column, row)] === WALL;
            if (Math.abs(best - capsule.radius) > 1e-3 && inside !== marked) mismatched++;
            if (marked) solid++;
        }
    }
    check('the capsule marks exactly the cells within its radius', mismatched === 0 && solid > 0,
        `${mismatched} cells disagree`);
    const point = new Plate(MESH_SIZES.indexOf(64), 32);
    addGeometry(point, { solids: [{ kind: 'capsule', x0: 0.5, y0: 0.5, x1: 0.5, y1: 0.5, radius: 0.15, type: WALL }] });
    const circle = new Plate(MESH_SIZES.indexOf(64), 32);
    addGeometry(circle, { solids: [{ kind: 'circle', centerX: 0.5, centerY: 0.5, radius: 0.15, type: WALL }] });
    const same = point.typeCenter.every((t, k) => t === circle.typeCenter[k]);
    check('a capsule of zero length marks what the circle does, at every level', same);
    console.log(`  ${solid} cells marked at 64, ${mismatched} against the independent distance`);
});

section('5. AN EDIT RE-MARKS THE RUNNING PLATE', () => {
    const finest = MESH_SIZES.indexOf(128);
    const typesOf = (plate) => [plate.typeCenter, plate.typeXFace, plate.typeYFace];
    const sameTypes = (a, b) => typesOf(a).every((array, k) => array.every((t, i) => t === typesOf(b)[k][i]));
    const fresh = (preset) => { const p = new Plate(finest, preset.solver.coarsestCells); caseGeometry(p, preset); return p; };
    const layouts = {
        'the default': sandbox,
        'a box and a carve': layout({ shapes: [
            { kind: 'box', x0: 0.3, y0: 0.1, x1: 0.7, y1: 0.9, solid: true },
            { kind: 'capsule', x0: 0.3, y0: 0.5, x1: 0.7, y1: 0.5, radius: 0.07, solid: false },
        ] }),
        'ports moved, slip edges, no shapes': layout({ shapes: [],
            edges: { left: WALL, right: WALL, top: SYMMETRY, bottom: SYMMETRY },
            ports: [{ edge: 'top', from: 0.125, to: 0.375, type: INLET, speed: 0.4, feedA: 1, feedB: 1 },
                    { edge: 'bottom', from: 0.5, to: 1, type: OUTLET }] }),
    };
    let pairs = 0;
    for (const [nameA, a] of Object.entries(layouts)) {
        for (const [nameB, b] of Object.entries(layouts)) {
            if (nameA === nameB) continue;
            const live = fresh(a);
            check(`${nameA} and ${nameB} classify differently, so the pair tests something`,
                !sameTypes(live, fresh(b)));
            caseGeometry(live, b);
            check(`${nameA}, then ${nameB}: the plate built fresh for ${nameB}`, sameTypes(live, fresh(b)));
            pairs++;
        }
    }
    console.log(`  ${pairs} edits applied to a classified plate at 128, ${fresh(sandbox).numLevels} levels each`);
});

section('6. THE EDITOR\'S ARITHMETIC', () => {
    const coarsest = sandbox.solver.coarsestCells;
    check('a port end snaps to a coarsest face', sandboxSnapAlongEdge(0.3, coarsest) === 10 / 32
        && sandboxSnapAlongEdge(-0.2, coarsest) === 0 && sandboxSnapAlongEdge(1.3, coarsest) === 1);

    const from = { x: 0.6, y: 0.2 }, to = { x: 0.3, y: 0.6 };
    const circle = sandboxShapeFromDrag('circle', from, to, { ink: 'solid' });
    check('a circle is drawn from its center out to its rim',
        circle.x === 0.6 && circle.y === 0.2 && Math.abs(circle.radius - 0.5) < 1e-12 && circle.solid);
    const box = sandboxShapeFromDrag('box', from, to, { ink: 'carve' });
    check('a box is drawn corner to corner, either way round',
        box.x0 === 0.3 && box.x1 === 0.6 && box.y0 === 0.2 && box.y1 === 0.6 && box.solid === false);
    const capsule = sandboxShapeFromDrag('capsule', from, to, { ink: 'solid', width: 0.1 });
    check('a capsule follows the stroke with half the width as its radius',
        capsule.x0 === 0.6 && capsule.y1 === 0.6 && capsule.radius === 0.05);

    const declared = sandboxLayoutOf(sandbox);
    const added = sandboxNewPort(declared, coarsest);
    check('a new port is an outlet on the longest free stretch',
        added && added.type === OUTLET && ['top', 'bottom'].includes(added.edge)
        && Math.abs(added.to - added.from - 0.25) < 1e-12, JSON.stringify(added));
    check('a new port is accepted where it is put',
        sandboxProblems(layout({ ports: [...declared.ports, added] })).length === 0);
    const full = { ...declared, ports: ['left', 'top', 'right', 'bottom'].map((edge) =>
        ({ edge, from: 0, to: 1, type: OUTLET })) };
    check('no new port where every edge is taken', sandboxNewPort(full, coarsest) === null);

    declared.ports[0].from = 0.9;
    declared.shapes.push({ kind: 'circle', x: 0.5, y: 0.5, radius: 0.1 });
    check('a layout is a copy, and editing it writes into no preset',
        sandbox.geometry.ports[0].from === 0 && sandbox.geometry.shapes.length === 1);

    const base = sandboxLayoutOf(sandbox);
    const faster = sandboxLayoutOf(sandbox);
    faster.ports[0].speed = 0.9; faster.ports[1].feedA = 0.3;
    const moved = sandboxLayoutOf(sandbox);
    moved.ports[0].to = 0.375;
    check('a speed or a feed needs no re-mark',
        sandboxLayoutGeometryKey(base) === sandboxLayoutGeometryKey(faster));
    check('an extent does', sandboxLayoutGeometryKey(base) !== sandboxLayoutGeometryKey(moved));

    appSelectPreset(sandbox.id);
    appSetLayout(faster);
    check('the override reaches the running preset', appActivePreset().geometry.ports[0].speed === 0.9);
    appSetResolution(128);
    check('a resolution change keeps it', appActivePreset().geometry.ports[0].speed === 0.9);
    const plate = new Plate(MESH_SIZES.indexOf(64), coarsest);
    const summary = caseSummary(appActivePreset(), plate, NaN);
    check('the panel takes the fastest inlet port as the speed', summary.velocityScale === 0.9,
        `${summary.velocityScale}`);
    check('an outlet is not an inlet', caseFastestPort([{ type: OUTLET, speed: 3 }]) === 0);
    appSelectPreset(sandbox.id);
    check('choosing a case clears it', appActivePreset().geometry.ports[0].speed === sandbox.geometry.ports[0].speed);
    check('the declared layout is the preset\'s',
        JSON.stringify(appDeclaredLayout()) === JSON.stringify(sandboxLayoutOf(sandbox)));
    const text = sandboxLayoutText(sandboxLayoutOf(sandbox));
    check('the export writes a layout with its types in words',
        /"left":"wall"/.test(text) && /"type":"inlet"/.test(text) && /"type":"outlet"/.test(text)
        && JSON.parse(text).shapes.length === sandbox.geometry.shapes.length, text);
    console.log(`  new port: ${added.edge} ${added.from} to ${added.to}; panel speed `
        + `${summary.velocityScale} from ports at 0.9 and 0.5`);
});

section('7. PAINT LIES AT EACH ARRAY\'S OWN POINTS, AND THE ROWS READ IT', () => {
    // An independent restatement of what a region covers, written from the
    // geometry and not from the plate's own test, so a wrong rasterization is
    // not checked against itself.
    const inDisk = (q, x, y, r) => (q.x - x) ** 2 + (q.y - y) ** 2 <= r * r;
    const plate = new Plate(MESH_SIZES.indexOf(64), 16);
    const disk = { kind: 'circle', centerX: 0.4, centerY: 0.45, radius: 0.2 };
    addGeometry(plate, { paints: [{ shape: disk, material: 'porous', strength: 4 }] });
    let faces = 0, wrong = 0, centersLeft = 0;
    for (let level = 0; level < plate.numLevels; level++) {
        const h = plate.spacing[level];
        for (const [location, array] of [[XFACE, plate.paintPorousXFace], [YFACE, plate.paintPorousYFace]]) {
            for (let b = 0; b < plate.heightAt(location, level); b++) {
                for (let a = 0; a < plate.widthAt(location, level); a++) {
                    const q = positionOf(location, a, b, h);
                    const want = inDisk(q, 0.4, 0.45, 0.2) ? 4 : 0;
                    const got = array[plate.indexOf(location, level, a, b)];
                    if (got !== want) wrong++;
                    if (want) faces++;
                }
            }
        }
        for (let row = 0; row < plate.heightCenter[level]; row++) {
            for (let column = 0; column < plate.widthCenter[level]; column++) {
                if (plate.paintCatalystCenter[plate.indexCenter(level, column, row)] !== 0) centersLeft++;
            }
        }
    }
    check('porous paint marks exactly the faces whose own position it covers, on every level',
        wrong === 0 && faces > 0, `${wrong} faces wrong of ${faces} inside`);
    check('porous paint leaves the catalyst array empty', centersLeft === 0, `${centersLeft} centers painted`);

    // Layers: each material keeps its own array, so an overlap holds both, and
    // within one material the later region decides the strength.
    const overlap = (first, second, after = []) => {
        const p = new Plate(MESH_SIZES.indexOf(64), 16);
        addGeometry(p, { paints: [
            { shape: { kind: 'rect', x0: 0.2, y0: 0.2, x1: 0.6, y1: 0.6 }, material: first, strength: 2 },
            { shape: { kind: 'rect', x0: 0.4, y0: 0.4, x1: 0.8, y1: 0.8 }, material: second, strength: 8 },
            ...after] });
        return p;
    };
    const at = (p, location, x, y) => {
        const h = p.spacing[0];
        const column = Math.floor(x / h) + 1, row = Math.floor(y / h) + 1;
        return location === CENTER ? p.paintCatalystCenter[p.indexCenter(0, column, row)]
            : p.paintPorousXFace[p.indexXFace(0, Math.round(x / h) + 1, row)];
    };
    const catalystThenPorous = overlap('catalyst', 'porous');
    check('catalyst then porous: the overlap holds both, each at its own strength',
        at(catalystThenPorous, XFACE, 0.5, 0.5) === 8 && at(catalystThenPorous, CENTER, 0.5, 0.5) === 2
        && at(catalystThenPorous, XFACE, 0.3, 0.3) === 0);
    const porousThenCatalyst = overlap('porous', 'catalyst');
    check('porous then catalyst: the overlap holds both, each at its own strength',
        at(porousThenCatalyst, CENTER, 0.5, 0.5) === 8 && at(porousThenCatalyst, XFACE, 0.5, 0.5) === 2
        && at(porousThenCatalyst, CENTER, 0.3, 0.3) === 0);
    const twice = overlap('catalyst', 'catalyst');
    check('within one material the later region decides the strength',
        at(twice, CENTER, 0.5, 0.5) === 8 && at(twice, CENTER, 0.3, 0.3) === 2);
    const bed = overlap('porous', 'catalyst',
        [{ shape: { kind: 'rect', x0: 0.45, y0: 0.45, x1: 0.55, y1: 0.55 }, material: 'bare' }]);
    check('bare clears every layer it covers',
        at(bed, CENTER, 0.5, 0.5) === 0 && at(bed, XFACE, 0.5, 0.5) === 0 && at(bed, CENTER, 0.7, 0.7) === 8);
    const cleared = overlap('catalyst', 'bare');
    check('bare clears what it covers and nothing else',
        at(cleared, CENTER, 0.5, 0.5) === 0 && at(cleared, CENTER, 0.3, 0.3) === 2);

    // A stroke marks the union of its segments' capsules.
    const points = [{ x: 0.15, y: 0.2 }, { x: 0.5, y: 0.35 }, { x: 0.45, y: 0.8 }, { x: 0.8, y: 0.7 }];
    const stroked = new Plate(MESH_SIZES.indexOf(64), 16);
    addGeometry(stroked, { solids: [{ kind: 'stroke', points, radius: 0.05 }] });
    const capsules = new Plate(MESH_SIZES.indexOf(64), 16);
    addGeometry(capsules, { solids: points.slice(1).map((point, k) => ({ kind: 'capsule',
        x0: points[k].x, y0: points[k].y, x1: point.x, y1: point.y, radius: 0.05 })) });
    const walls = (p) => p.typeCenter.reduce((n, t) => n + (t === WALL ? 1 : 0), 0);
    check('a stroke marks exactly the cells its segments\' capsules do, on every level',
        stroked.typeCenter.every((t, k) => t === capsules.typeCenter[k]) && walls(stroked) > walls(new Plate(MESH_SIZES.indexOf(64), 16)));
    const one = sandboxStrokeExtend({ kind: 'stroke', points: [{ x: 0.5, y: 0.5 }], radius: 0.04 },
        { x: 0.51, y: 0.5 });
    check('a stroke ignores a point closer than a quarter of its width', one.points.length === 1);
    check('and takes one farther away', sandboxStrokeExtend(one, { x: 0.6, y: 0.5 }).points.length === 2);

    // A pellet is a solid core in a catalyst shell.
    const pellet = new Plate(MESH_SIZES.indexOf(64), 16);
    addGeometry(pellet, caseShapeGeometry({ kind: 'pellet', x: 0.5, y: 0.5, radius: 0.2, shell: 0.05, strength: 4 }));
    let core = 0, shell = 0, misplaced = 0;
    for (let row = 1; row <= 64; row++) {
        for (let column = 1; column <= 64; column++) {
            const q = positionOf(CENTER, column, row, pellet.spacing[0]);
            const k = pellet.indexCenter(0, column, row);
            const inner = inDisk(q, 0.5, 0.5, 0.15), outer = inDisk(q, 0.5, 0.5, 0.2);
            if (inner) { core++; if (pellet.typeCenter[k] !== WALL) misplaced++; }
            else if (outer) { shell++; if (pellet.typeCenter[k] !== FLUID || pellet.paintCatalystCenter[k] !== 4) misplaced++; }
            else if (pellet.paintCatalystCenter[k] !== 0 || pellet.typeCenter[k] !== FLUID) misplaced++;
        }
    }
    check('a pellet is solid inside its core, catalyst in its shell, and nothing outside',
        misplaced === 0 && core > 0 && shell > 0, `${misplaced} cells misplaced`);
    const least = 2 / sandbox.solver.coarsestCells;
    const refusedPellet = sandboxProblems(layout({ shapes: [
        { kind: 'pellet', x: 0.5, y: 0.5, radius: 0.1, shell: 0.1 - 0.45 * least, strength: 1 }] }));
    check('refused: a pellet whose core is narrower than two coarsest cells',
        refusedPellet.some((p) => /pellet core/.test(p)), refusedPellet.join(' / '));
    check('a pellet whose core is two coarsest cells is accepted', sandboxProblems(layout({ shapes: [
        { kind: 'pellet', x: 0.5, y: 0.5, radius: 0.1, shell: 0.1 - 0.5 * least, strength: 1 }] })).length === 0);

    // The rows read it: the generated shader names the painted arrays and
    // slots, and the case with no paint reads none of them.
    const reacting = casePresets().find((p) => p.caseId === sandbox.caseId && p.reaction === 'massAction');
    appSelectPreset(reacting.id);
    const run = new Plate(MESH_SIZES.indexOf(64), reacting.solver.coarsestCells);
    caseGeometry(run, reacting);
    run.allocateFields();
    run.setCoefficients(appCoefficientValues());
    const source = buildSimulationSource(run, appSystem(), physicsBoundaryTable(reacting), 8, appActivePreset().display);
    const bodyOf = (name) => {
        const start = source.indexOf(`fn ${name}(`);
        return start < 0 ? '' : source.slice(start, source.indexOf('\nfn ', start + 1) < 0 ? undefined : source.indexOf('\nfn ', start + 1));
    };
    check('species A reads the catalyst array in its terms',
        /paintCatalystCenter/.test(bodyOf('terms_speciesA')));
    check('x velocity reads the porous array in its terms', /paintPorousXFace/.test(bodyOf('terms_xVelocity')));
    check('y velocity reads the porous array in its terms', /paintPorousYFace/.test(bodyOf('terms_yVelocity')));

    // The refusals of the form.
    const raises = (fn) => { try { fn(); return false; } catch (error) { return true; } };
    const painted = coefficientPainted('paintCatalystCenter', coefficientSlot('reactionRate'),
        coefficientSlot('paintedReactionRate'));
    check('painting a coefficient inside a flux is refused', raises(() => normalizeEquation({
        field: 'speciesA', location: CENTER, terms: [{ term: 'diffusion', diffusivity: painted }] })));
    check('a painted coefficient read at another location is refused',
        raises(() => coefficientValueOf(run, painted, { p: 0, location: XFACE })));
    check('a painted coefficient read with no point is refused', raises(() => coefficientValueOf(run, painted)));
    appSelectPreset(sandbox.id);
    console.log(`  ${faces} porous faces placed across ${plate.numLevels} levels; `
        + `pellet ${core} core and ${shell} shell cells at 64`);
});

section('8. A SAVED CASE IS DATA, AND READS BACK AS THE CASE THAT WAS SAVED', () => {
    // A layout with a port, a shape and paint, and two sliders moved.
    appSelectPreset('sandboxMassAction');
    const layout = appDeclaredLayout();
    layout.shapes.push({ kind: 'box', x0: 0.5, y0: 0.3, x1: 0.7, y1: 0.7, paint: 'porous', strength: 4 },
        { kind: 'circle', x: 0.6, y: 0.5, radius: 0.08, paint: 'catalyst', strength: 8 });
    appSetLayout(layout);
    appSetCoefficient('viscosity', 0.003);
    appSetCoefficient('reactionRate', 30);
    const taken = caseCases().map(({ id }) => id);
    const data = sandboxExportData(appActivePreset(), 'Catalytic bed', appCoefficientOverrides(), taken);
    const text = sandboxExportText(data);
    check('the saved file calls caseRegisterExported once and holds no function',
        text.split('caseRegisterExported(').length === 2 && !/=>|function/.test(text.slice(text.indexOf('('))));
    const read = sandboxParseExport(text);
    check('it reads back to the same data', JSON.stringify(read) === JSON.stringify(data));
    check('its id is a word named for its label', read.id === 'catalyticBed', read.id);
    check('an id already in use is stepped around',
        sandboxExportData(appActivePreset(), 'Sandbox', {}, taken).id === 'sandbox2');
    const presets = casePresets().filter((preset) => preset.caseId === 'sandbox');
    const sliders = ['viscosity', 'reactionRate', 'massDiffusivity', 'porousPermeability', 'paintedReactionRate'];
    check('it loads with no problem', sandboxImportProblems(read, presets, sliders).length === 0,
        sandboxImportProblems(read, presets, sliders).join(' '));

    // Registered, it is the sandbox with that layout, opening on that
    // reaction with those values; the registration is undone after.
    const before = caseCases().length;
    const unregister = caseRegisterExported(read);
    const preset = casePresets().find((candidate) => candidate.id === 'catalyticBedMassAction');
    check('registered, it adds one case', caseCases().length === before + 1);
    check('and its mass action preset carries the saved layout',
        !!preset && JSON.stringify(sandboxLayoutOf(preset)) === JSON.stringify(layout));
    check('and the saved slider values',
        !!preset && preset.coefficients.viscosity === 0.003 && preset.coefficients.reactionRate === 30);
    const caseDeclared = caseCases().find((declaration) => declaration.id === 'catalyticBed');
    check('and opens on the saved reaction', !!caseDeclared && caseDeclared.defaultReaction === 'massAction');
    const other = casePresets().find((candidate) => candidate.id === 'catalyticBedMonod');
    check('while its other reactions keep their own rates',
        !!other && other.coefficients.reactionRate !== 30 && other.coefficients.viscosity === 0.003);
    unregister();
    check('and taken back out, the case set is as it was', caseCases().length === before);

    // What it refuses: a file that is not one, an edited file, an unknown
    // slider, a refused layout. The positive control for each is the load
    // above passing.
    const raises = (fn) => { try { fn(); return false; } catch (error) { return true; } };
    check('a file that is not a saved case is refused', raises(() => sandboxParseExport('let x = 1;')));
    check('a saved case edited into code is refused',
        raises(() => sandboxParseExport(text.replace('"Catalytic bed"', 'alert(1)'))));
    check('an unknown slider is refused',
        sandboxImportProblems({ ...read, controls: { gravity: 1 } }, presets, sliders).length === 1);
    const narrow = sandboxCopyLayout(layout);
    narrow.shapes.push({ kind: 'circle', x: 0.3, y: 0.3, radius: 0.001, solid: true });
    check('a layout the sandbox refuses is refused',
        sandboxImportProblems({ ...read, layout: narrow }, presets, sliders).length > 0);
});

heading('RESULT');
console.log(`  ${passCount} checks passed.`);
if (failures.length) {
    console.log(`  ${failures.length} FAILED:`);
    for (const f of failures.slice(0, 40)) console.log(`    ${f}`);
}
process.exitCode = failures.length === 0 ? 0 : 1;
});
