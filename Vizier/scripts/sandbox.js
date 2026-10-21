// sandbox.js, by Allen Rakhamimov.
// What the sandbox refuses, and what its editor does to a layout.
//
// Plain functions on plain data, so a check can call them. The page owns only
// the DOM and the pointer; every edit it makes is one of these followed by
// sandboxProblems, and a refused edit changes nothing. Nothing in the solver
// depends on this file.

'use strict';

// What the sandbox refuses

// What the sandbox refuses, as sentences a viewer can act on; an empty list
// accepts the layout. Each refusal is cheap and well posed, and anything
// subtler is left to the divergence watchdog.
function sandboxProblems(preset) {
    const problems = [];
    const coarsest = preset.solver.coarsestCells;
    const least = 2 / coarsest;                 // two cells on the coarsest level
    const ports = preset.geometry.ports || [];
    const shapes = preset.geometry.shapes || [];
    const size = (x) => x.toFixed(3);

    if (ports.length > boundaryPortCount()) {
        problems.push(`At most ${boundaryPortCount()} inlets and outlets; this layout has ${ports.length}.`);
    }
    ports.forEach((port, k) => {
        const name = sandboxPortName(port, ports);
        if (!(port.from >= 0 && port.to <= 1 && port.from < port.to)) {
            problems.push(`${name} has to start before it ends and stay on its edge.`);
        } else if (port.to - port.from < least - 1e-9) {
            problems.push(`${name} is ${size(port.to - port.from)} long, and the shortest the solver `
                + `keeps on every grid level is ${size(least)}.`);
        }
        for (const earlier of ports.slice(0, k)) {
            if (earlier.edge === port.edge && port.from < earlier.to && earlier.from < port.to) {
                problems.push(`${name} overlaps another on the same edge.`);
            }
        }
    });
    const inlets = ports.filter((port) => port.type === INLET && port.speed !== 0);
    const outlets = ports.filter((port) => port.type === OUTLET).length
        + Object.values(preset.geometry.edges).filter((type) => type === OUTLET).length;
    if (inlets.length > 0 && outlets === 0) {
        problems.push('Fluid fed in has to leave somewhere: add an outlet.');
    }
    for (const shape of shapes) {
        // A pellet's core has to survive every level; a thin shell is only
        // missing from the coarse operator.
        const narrowest = shape.kind === 'box'
            ? Math.min(Math.abs(shape.x1 - shape.x0), Math.abs(shape.y1 - shape.y0))
            : shape.kind === 'pellet' ? 2 * (shape.radius - shape.shell)
            : 2 * shape.radius;
        if (narrowest < least - 1e-9) {
            problems.push(`A ${shape.kind === 'pellet' ? 'pellet core' : shape.kind} ${size(Math.max(0, narrowest))} `
                + `across is narrower than the `
                + `${size(least)} the solver keeps on every grid level.`);
        }
    }
    if (problems.length === 0 && inlets.length > 0) {
        for (const port of sandboxUnreached(preset)) {
            problems.push(`${sandboxPortName(port, ports)} has no path to an outlet.`);
        }
    }
    return problems;
}

// The editor's arithmetic

// A layout is the three things a viewer edits, edges, ports and shapes, the
// part of a preset's geometry the editor owns. Always copied, so that an edit
// never writes into a preset or into an earlier entry on the undo stack.
function sandboxLayoutOf(preset) {
    return sandboxCopyLayout(preset.geometry);
}

function sandboxCopyLayout(layout) {
    return {
        edges: { ...layout.edges },
        ports: (layout.ports || []).map((port) => ({ ...port })),
        shapes: (layout.shapes || []).map((shape) => (shape.points
            ? { ...shape, points: shape.points.map((point) => ({ x: point.x, y: point.y })) }
            : { ...shape })),
    };
}

// The preset with a viewer's layout in place of its own.
function sandboxWithLayout(preset, layout) {
    return { ...preset, geometry: { ...preset.geometry, ...sandboxCopyLayout(layout) } };
}

// A port's ends sit on coarsest-level cell faces. A port that started inside a
// coarse cell would mark that cell on some levels and not on others, and the
// refusal's two-cell minimum would mean something different at each end.
function sandboxSnapAlongEdge(value, coarsest) {
    return Math.min(1, Math.max(0, Math.round(value * coarsest) / coarsest));
}

// What a shape lays down, chosen in the editor: solid and carve change the
// geometry, and catalyst, porous and bare paint a material at a strength.
const SANDBOX_INKS = ['solid', 'carve', 'catalyst', 'porous', 'bare'];

function sandboxInkFields(ink, strength) {
    switch (ink) {
        case 'solid': return { solid: true };
        case 'carve': return { solid: false };
        case 'bare':  return { paint: 'bare', strength: 0 };
        case 'catalyst': case 'porous': return { paint: ink, strength };
    }
    throw new Error(`a shape lays down ${SANDBOX_INKS.join(', ')}, not ${ink}`);
}

// The ink a shape was drawn with, for the outline the editor shows.
function sandboxInkOf(shape) {
    if (shape.kind === 'pellet') return 'catalyst';
    if (shape.paint !== undefined) return shape.paint;
    return shape.solid === false ? 'carve' : 'solid';
}

// The shape a drag from `from` to `to` draws, with the editor's settings in
// `pen` ({ ink, width, strength, shell }): a circle from its center out to
// its rim, a box from corner to corner, a capsule along the stroke at the
// pen's width. A brush starts a stroke at `from` alone, and the drag extends
// it (sandboxStrokeExtend). A pellet is drawn like a circle and is always a
// solid core in a catalyst shell, whatever the ink. Positions are the unit
// square, y down the screen.
function sandboxShapeFromDrag(tool, from, to, pen) {
    const { ink, width = 0, strength = 1, shell = 0 } = pen;
    if (tool === 'pellet') {
        return { kind: 'pellet', x: from.x, y: from.y,
            radius: Math.hypot(to.x - from.x, to.y - from.y), shell, strength };
    }
    const fields = sandboxInkFields(ink, strength);
    switch (tool) {
        case 'circle':
            return { kind: 'circle', x: from.x, y: from.y,
                radius: Math.hypot(to.x - from.x, to.y - from.y), ...fields };
        case 'box':
            return { kind: 'box', x0: Math.min(from.x, to.x), y0: Math.min(from.y, to.y),
                x1: Math.max(from.x, to.x), y1: Math.max(from.y, to.y), ...fields };
        case 'capsule':
            return { kind: 'capsule', x0: from.x, y0: from.y, x1: to.x, y1: to.y,
                radius: width / 2, ...fields };
        case 'brush':
            return { kind: 'stroke', points: [{ x: from.x, y: from.y }], radius: width / 2, ...fields };
    }
    throw new Error(`a drawing tool is a circle, a box, a capsule, a brush or a pellet, not ${tool}`);
}

// A brush stroke carried on to `point`, or the same stroke when the point is
// closer to its last one than a quarter of the stroke's width: points that
// close add nothing a viewer could see and cost the classification a segment
// each. Returns a new shape and never edits the one it was given.
function sandboxStrokeExtend(stroke, point) {
    const last = stroke.points[stroke.points.length - 1];
    if (Math.hypot(point.x - last.x, point.y - last.y) < stroke.radius / 2) return stroke;
    return { ...stroke, points: [...stroke.points.map((each) => ({ ...each })), { x: point.x, y: point.y }] };
}

// Where a new port goes: the longest free stretch of any edge, a quarter of
// the edge at most, as an outlet, since adding an outlet cannot strand an
// inlet. Null when no edge has two coarsest cells free.
function sandboxNewPort(layout, coarsest) {
    let best = null;
    for (const edge of CASE_PORT_EDGES) {
        const taken = layout.ports.filter((port) => port.edge === edge)
            .map((port) => [port.from, port.to]).sort((first, second) => first[0] - second[0]);
        let start = 0;
        for (const [from, to] of [...taken, [1, 1]]) {
            if (!best || from - start > best.to - best.from) best = { edge, from: start, to: from };
            start = Math.max(start, to);
        }
    }
    if (!best || best.to - best.from < 2 / coarsest - 1e-9) return null;
    const length = Math.min(0.25, best.to - best.from);
    const from = sandboxSnapAlongEdge(best.from + (best.to - best.from - length) / 2, coarsest);
    return { edge: best.edge, from, to: sandboxSnapAlongEdge(from + length, coarsest), type: OUTLET,
        speed: 0.5, feedA: 1, feedB: 0 };
}

// Whether two layouts classify differently. A change of speed or feed is a
// slot write only, and the page skips the re-mark for it.
function sandboxLayoutGeometryKey(layout) {
    return JSON.stringify([layout.edges, layout.shapes,
        layout.ports.map((port) => [port.edge, port.from, port.to, port.type])]);
}

// A layout as one line of JSON with its types in words, for the run export, so
// a file written from the sandbox says what the viewer had built.
function sandboxLayoutText(layout) {
    const edges = {};
    for (const [edge, type] of Object.entries(layout.edges)) edges[edge] = sandboxTypeWord(type);
    return JSON.stringify({ edges,
        ports: layout.ports.map((port) => ({ ...port, type: sandboxTypeWord(port.type) })),
        shapes: layout.shapes });
}

// A case saved from the sandbox
//
// A saved case is a case file: one call, caseRegisterExported, holding plain
// data (the layout, the reaction and the slider values) and no code. Put in
// scripts/cases/ and listed in manifest.js it becomes a case of its own; loaded
// back into the page it is read as data, never run.

const SANDBOX_EXPORT_FORMAT = 'vizier sandbox case';
const SANDBOX_EXPORT_VERSION = 1;

// The data a saved case holds. `controls` are the sliders the viewer moved,
// by the names the sliders carry; `taken` are the case ids already in use,
// which the saved id steps around.
function sandboxExportData(preset, label, controls, taken = []) {
    const words = label.trim().replace(/[^A-Za-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);
    const id = words.length
        ? words.map((word, k) => (k ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word.toLowerCase())).join('')
        : 'savedCase';
    let unique = /^[a-z]/.test(id) ? id : `case${id}`;
    for (let k = 2; taken.includes(unique); k++) unique = `${unique.replace(/\d+$/, '')}${k}`;
    return {
        format: SANDBOX_EXPORT_FORMAT, version: SANDBOX_EXPORT_VERSION,
        id: unique, label: label.trim() || 'Saved case',
        note: 'A case built in the sandbox. Every tool still works on it.',
        reaction: preset.reaction || 'none',
        layout: sandboxLayoutOf(preset),
        controls: { ...controls },
    };
}

function sandboxExportText(data) {
    return `// ${data.id}.js, saved from the Vizier sandbox.\n`
        + '// To add it to the case box, put this file in scripts/cases/ and list it in\n'
        + '// manifest.js after sandbox.js. To open it again, load it from the Build card.\n\n'
        + "'use strict';\n\n"
        + `caseRegisterExported(${JSON.stringify(data, null, 4)});\n`;
}

// The data in a saved case's text, read as JSON between the call's brackets
// and never run. Throws a sentence a viewer can act on.
function sandboxParseExport(text) {
    const start = text.indexOf('caseRegisterExported(');
    const end = text.lastIndexOf(');');
    if (start < 0 || end < start) throw new Error('That file is not a case saved from the sandbox.');
    let data;
    try {
        data = JSON.parse(text.slice(start + 'caseRegisterExported('.length, end));
    } catch (error) {
        throw new Error('That case file has been edited into something that is not data.');
    }
    if (data.format !== SANDBOX_EXPORT_FORMAT) throw new Error('That file is not a case saved from the sandbox.');
    if (data.version !== SANDBOX_EXPORT_VERSION) {
        throw new Error(`That case was saved in format ${data.version}; this page reads ${SANDBOX_EXPORT_VERSION}.`);
    }
    return data;
}

// What stops a saved case from loading into `sandboxPresets`, the sandbox's
// presets by reaction, as sentences; empty when it loads. `sliders` are the
// names a slider may carry.
function sandboxImportProblems(data, sandboxPresets, sliders) {
    const problems = [];
    const preset = sandboxPresets.find((candidate) => (candidate.reaction || 'none') === data.reaction);
    if (!preset) {
        problems.push(`The sandbox has no reaction named ${data.reaction}.`);
        return problems;
    }
    for (const [name, value] of Object.entries(data.controls || {})) {
        if (!sliders.includes(name)) problems.push(`The sandbox has no slider named ${name}.`);
        else if (!(Number.isFinite(value) && value >= 0)) problems.push(`The ${name} slider cannot be set to ${value}.`);
    }
    const layout = data.layout || {};
    if (!layout.edges || !Array.isArray(layout.ports) || !Array.isArray(layout.shapes)) {
        problems.push('The case has no layout of edges, ports and shapes.');
        return problems;
    }
    return problems.concat(sandboxProblems(sandboxWithLayout(preset, layout)));
}

// A port as a refusal names it: by its edge and type, and by where it runs
// along the edge when that edge carries more than one port, so two inlets on
// one edge are not both "the left inlet".
function sandboxPortName(port, ports) {
    const name = `The ${port.edge} ${sandboxTypeWord(port.type)}`;
    if (ports.filter((other) => other.edge === port.edge).length < 2) return name;
    return `${name} from ${+port.from.toFixed(3)} to ${+port.to.toFixed(3)}`;
}

// A function and not a table, because its keys are another file's constants.
function sandboxTypeWord(type) {
    return { [INLET]: 'inlet', [OUTLET]: 'outlet', [SYMMETRY]: 'symmetry edge', [WALL]: 'wall' }[type]
        || 'port';
}

// The inlets from which no fluid path reaches an outlet, found by a flood fill
// on the coarsest level: a passage the coarse grid closes is closed to the
// coarse correction too.
function sandboxUnreached(preset) {
    const plate = new Plate(MESH_SIZES.indexOf(preset.solver.coarsestCells), preset.solver.coarsestCells);
    caseGeometry(plate, preset);
    const interiorCells = plate.interior[0];
    const width = interiorCells + 2;
    const inside = (column, row) => column >= 1 && column <= interiorCells
        && row >= 1 && row <= interiorCells;
    const typeAt = (column, row) => plate.typeCenter[plate.indexCenter(0, column, row)];
    const neighbors = (column, row) =>
        [[column - 1, row], [column + 1, row], [column, row - 1], [column, row + 1]];
    const isFluid = (column, row) => inside(column, row) && typeAt(column, row) === FLUID;
    const touches = (column, row, type) =>
        neighbors(column, row).some(([nextColumn, nextRow]) => typeAt(nextColumn, nextRow) === type);

    const unreached = [];
    for (const port of (preset.geometry.ports || []).filter((p) => p.type === INLET && p.speed !== 0)) {
        const range = casePortRanges([port])[0];
        const fedByThisPort = (column, row) => {
            if (inside(column, row) || typeAt(column, row) !== INLET) return false;
            const position = positionOf(CENTER, column, row, plate.spacing[0]);
            const along = boundaryPerimeterOf(position.x, position.y);
            return along >= range.start && along <= range.end;
        };
        const seen = new Uint8Array(width * width);
        const queue = [];
        for (let row = 1; row <= interiorCells; row++) {
            for (let column = 1; column <= interiorCells; column++) {
                if (!isFluid(column, row)) continue;
                if (neighbors(column, row).some(([ghostColumn, ghostRow]) => fedByThisPort(ghostColumn, ghostRow))) {
                    seen[column + row * width] = 1;
                    queue.push([column, row]);
                }
            }
        }
        let reached = false;
        while (queue.length > 0 && !reached) {
            const [column, row] = queue.pop();
            if (touches(column, row, OUTLET)) { reached = true; break; }
            for (const [nextColumn, nextRow] of neighbors(column, row)) {
                if (isFluid(nextColumn, nextRow) && !seen[nextColumn + nextRow * width]) {
                    seen[nextColumn + nextRow * width] = 1;
                    queue.push([nextColumn, nextRow]);
                }
            }
        }
        // An inlet whose every neighbor is solid feeds nothing and needs no path.
        if (!reached && seen.some((value) => value)) unreached.push(port);
    }
    return unreached;
}
