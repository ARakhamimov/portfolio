// editor.js, by Allen Rakhamimov.
// The sandbox's Build card and build mode: drawing shapes and ports with the
// pointer or the keys, offered only while the sandbox runs.
//
// Every edit goes to the page through edit.apply, which asks sandboxProblems
// first and leaves the running layout alone when anything is refused, so
// nothing here touches a buffer or decides what is allowed. The arithmetic of
// an edit (snapping, the shape a drag draws, where a new port goes) is in
// sandbox.js. A shape being drawn is an outline over the picture, gone once it
// is placed; what stays is the staircase of cells the solver marks.

'use strict';

const EDITOR_TOOLS = ['circle', 'box', 'capsule', 'brush', 'pellet'];

// The strengths a catalyst or porous region may be painted at: one to eight
// times the slider's value, in octaves.
const EDITOR_STRENGTHS = [1, 2, 4, 8];

// What each ink means, for the button that chooses it.
const EDITOR_INK_TITLES = {
    solid: 'a wall the flow goes around',
    carve: 'cut fluid back out of what is solid',
    catalyst: 'a surface the reaction runs faster on',
    porous: 'a medium the flow seeps through',
    bare: 'clear catalyst and porous medium',
};

// Build mode borrows keys under the left hand for the crosshair, so a, s and d
// mean something else while it is on, and the key table says so by showing
// these in place of the ones they shadow.
const EDITOR_KEYS = [
    ['g / Esc', 'leave build mode (Esc first drops a shape half drawn)'],
    ['w a s d', 'move the crosshair a coarse cell; with shift, a fine one'],
    ['x', 'start a shape at the crosshair, then place it'],
    ['t / T', 'drawing tool'],
    ['q / Q', 'what is drawn: solid, carve, catalyst, porous or bare'],
    ['3 / 4', 'capsule or brush narrower or wider'],
    ['5 / 6', 'catalyst or porous weaker or stronger'],
    ['z', 'undo the last edit'],
];
const EDITOR_SHADOWED = ['a', 's / S', 'd'];

// The editor's own state: whether build mode is on, the tool, and where the
// crosshair and a half-drawn shape's first point are. The layout itself is
// not here; it is appCurrentLayout(), so there is one copy of it.
const editorCurrent = {};
function editorReset() {
    Object.assign(editorCurrent, {
        on: false, tool: 'circle', ink: 'solid', strength: 1, width: 0.125, shell: 1 / 32,
        cross: { x: 0.5, y: 0.5 }, anchor: null,
        // The brush stroke being drawn, while a drag or the x key holds it.
        stroke: null,
        saveName: 'My case',
    });
}
editorReset();

function editorOffered() { return appActivePreset().category === 'sandbox'; }

function editorToggle(edit) {
    editorCurrent.on = !editorCurrent.on && editorOffered();
    editorCurrent.anchor = null;
    editorCurrent.stroke = null;
    edit.redraw();
}

function editorPlace(from, to, edit) {
    const layout = appCurrentLayout();
    layout.shapes.push(sandboxShapeFromDrag(editorCurrent.tool, from, to, editorCurrent));
    editorCurrent.anchor = null;
    edit.apply(layout);
}

// A stroke is applied while it is drawn. The first dab is one undo step and
// each extension replaces the stroke in place; an extension the refusals turn
// down is dropped, so drawing on simply stops adding.
function editorBrushStart(point, edit) {
    const layout = appCurrentLayout();
    layout.shapes.push(sandboxShapeFromDrag('brush', point, point, editorCurrent));
    editorCurrent.stroke = edit.apply(layout) ? { index: layout.shapes.length - 1, pending: null } : null;
}

// `points` is one point or every point the pointer passed since the last
// frame, so a fast drag keeps its corners although the plate is re-marked only
// once a frame.
function editorBrushExtend(points, edit) {
    if (!editorCurrent.stroke) return;
    const layout = appCurrentLayout();
    const stroke = layout.shapes[editorCurrent.stroke.index];
    if (!stroke || stroke.kind !== 'stroke') { editorCurrent.stroke = null; return; }
    const extended = [].concat(points).reduce((shape, point) => sandboxStrokeExtend(shape, point), stroke);
    if (extended === stroke) return;
    layout.shapes[editorCurrent.stroke.index] = extended;
    edit.apply(layout, { record: false, redraw: false });
}

function editorBrushEnd(edit) {
    if (!editorCurrent.stroke) return;
    editorCurrent.stroke = null;
    edit.redraw();
}

const editorUnit = (value) => Math.min(1, Math.max(0, value));

// The build-mode keys. Returns whether it used the key, so the ordinary map
// below sees only the keys build mode leaves alone.
function editorKey(event, edit) {
    if (!editorOffered()) return false;
    // A select takes letters to jump between its options.
    if (event.target && event.target.tagName === 'SELECT') return false;
    if (event.key === 'g' || event.key === 'G') { editorToggle(edit); return true; }
    if (!editorCurrent.on) return false;

    const move = { w: [0, -1], a: [-1, 0], s: [0, 1], d: [1, 0] }[event.key.toLowerCase()];
    if (move) {
        const step = event.shiftKey ? 1 / edit.finest() : 1 / edit.coarsest();
        editorCurrent.cross = { x: editorUnit(editorCurrent.cross.x + move[0] * step), y: editorUnit(editorCurrent.cross.y + move[1] * step) };
        if (editorCurrent.stroke) editorBrushExtend(editorCurrent.cross, edit);
        editorDrawOverlay();
        return true;
    }
    const least = 2 / edit.coarsest();
    switch (event.key) {
        case 'Escape':
            if (editorCurrent.stroke) editorBrushEnd(edit);
            else if (editorCurrent.anchor) editorCurrent.anchor = null;
            else editorToggle(edit);
            break;
        case 'x': case 'X':
            if (editorCurrent.tool === 'brush') {
                if (editorCurrent.stroke) editorBrushEnd(edit); else editorBrushStart(editorCurrent.cross, edit);
            } else if (editorCurrent.anchor) editorPlace(editorCurrent.anchor, editorCurrent.cross, edit);
            else editorCurrent.anchor = { ...editorCurrent.cross };
            break;
        case 't': case 'T':
            editorCurrent.tool = EDITOR_TOOLS[pageWrapIndex(EDITOR_TOOLS.indexOf(editorCurrent.tool),
                EDITOR_TOOLS.length, event.key === 't')];
            edit.redraw();
            break;
        case 'q': case 'Q': {
            const inks = SANDBOX_INKS;
            editorCurrent.ink = inks[pageWrapIndex(inks.indexOf(editorCurrent.ink), inks.length, event.key === 'q')];
            edit.redraw();
            break;
        }
        case '5': case '6': {
            const k = EDITOR_STRENGTHS.indexOf(editorCurrent.strength) + (event.key === '6' ? 1 : -1);
            editorCurrent.strength = EDITOR_STRENGTHS[Math.min(EDITOR_STRENGTHS.length - 1, Math.max(0, k))];
            edit.redraw();
            break;
        }
        case '3': case '4':
            editorCurrent.width = Math.min(0.5, Math.max(least, editorCurrent.width + (event.key === '4' ? 1 : -1) / edit.coarsest()));
            edit.redraw();
            break;
        case 'z': case 'Z':
            edit.undo();
            break;
        default:
            return false;
    }
    editorDrawOverlay();
    return true;
}

// The pointer draws exactly what the keys do: press sets the first point,
// release places the shape. Outside build mode the picture ignores it.
function editorInstallPointer(canvas, edit) {
    // Measured inside the canvas border, where the picture is.
    const at = (event) => {
        const box = canvas.getBoundingClientRect();
        return { x: editorUnit((event.clientX - box.left - canvas.clientLeft) / canvas.clientWidth),
                 y: editorUnit((event.clientY - box.top - canvas.clientTop) / canvas.clientHeight) };
    };
    // A pointer reports far more often than a frame is drawn and a re-mark is
    // not cheap, so the points wait for the next frame and go together.
    let waiting = null;
    const extendSoon = (point) => {
        if (waiting) { waiting.push(point); return; }
        waiting = [point];
        requestAnimationFrame(() => {
            const points = waiting;
            waiting = null;
            // The release may have taken these already and ended the stroke.
            if (points) editorBrushExtend(points, edit);
        });
    };
    canvas.addEventListener('pointerdown', (event) => {
        if (!editorCurrent.on || event.button !== 0) return;
        canvas.setPointerCapture(event.pointerId);
        editorCurrent.cross = at(event);
        if (editorCurrent.tool === 'brush') editorBrushStart(at(event), edit);
        else editorCurrent.anchor = at(event);
        editorDrawOverlay();
        event.preventDefault();
    });
    canvas.addEventListener('pointermove', (event) => {
        if (!editorCurrent.on) return;
        editorCurrent.cross = at(event);
        if (editorCurrent.stroke) extendSoon(at(event));
        editorDrawOverlay();
    });
    canvas.addEventListener('pointerup', (event) => {
        if (!editorCurrent.on) return;
        if (editorCurrent.stroke) {
            const points = [...(waiting || []), at(event)];
            waiting = null;
            editorBrushExtend(points, edit);
            editorBrushEnd(edit);
        } else if (editorCurrent.anchor) {
            editorPlace(editorCurrent.anchor, at(event), edit);
        }
        editorDrawOverlay();
    });
    canvas.addEventListener('pointercancel', () => {
        editorCurrent.anchor = null;
        editorBrushEnd(edit);
        editorDrawOverlay();
    });
}

// One shape as SVG, in the unit square the overlay's viewBox maps onto the
// picture. A carve is dashed and a painted region dotted, so the kinds read
// apart without color.
function editorShapeSvg(shape) {
    const f = (value) => value.toFixed(4);
    const ink = sandboxInkOf(shape);
    const cls = ink === 'carve' ? ' class="carve"' : ink === 'solid' ? '' : ' class="paint"';
    if (shape.kind === 'box') {
        return `<rect${cls} x="${f(shape.x0)}" y="${f(shape.y0)}" `
            + `width="${f(shape.x1 - shape.x0)}" height="${f(shape.y1 - shape.y0)}"/>`;
    }
    if (shape.kind === 'pellet') {
        // The shell dotted, as paint is, and the core solid.
        const core = Math.max(0, shape.radius - shape.shell);
        return `<circle class="paint" cx="${f(shape.x)}" cy="${f(shape.y)}" r="${f(shape.radius)}"/>`
            + `<circle cx="${f(shape.x)}" cy="${f(shape.y)}" r="${f(core)}"/>`;
    }
    if (shape.kind === 'stroke') {
        // Only ever the brush's own cursor, a single point: a stroke is applied
        // as it is drawn, so the staircase under it is what stays.
        const q = shape.points[shape.points.length - 1];
        return `<circle${cls} cx="${f(q.x)}" cy="${f(q.y)}" r="${f(shape.radius)}"/>`;
    }
    const r = shape.radius;
    const length = shape.kind === 'capsule' ? Math.hypot(shape.x1 - shape.x0, shape.y1 - shape.y0) : 0;
    if (length < 1e-9) {
        const x = shape.kind === 'circle' ? shape.x : shape.x0;
        const y = shape.kind === 'circle' ? shape.y : shape.y0;
        return `<circle${cls} cx="${f(x)}" cy="${f(y)}" r="${f(r)}"/>`;
    }
    // Two straight sides a radius either side of the stroke, joined by half
    // circles round its ends.
    const nx = -(shape.y1 - shape.y0) / length * r;
    const ny = (shape.x1 - shape.x0) / length * r;
    return `<path${cls} d="M ${f(shape.x0 + nx)} ${f(shape.y0 + ny)} L ${f(shape.x1 + nx)} ${f(shape.y1 + ny)} `
        + `A ${f(r)} ${f(r)} 0 0 0 ${f(shape.x1 - nx)} ${f(shape.y1 - ny)} `
        + `L ${f(shape.x0 - nx)} ${f(shape.y0 - ny)} A ${f(r)} ${f(r)} 0 0 0 ${f(shape.x0 + nx)} ${f(shape.y0 + ny)} Z"/>`;
}

// The crosshair, and the shape half drawn. An overlay carries no data in its
// color, so it is a light line inside a dark one and reads on any picture,
// the way the direction arrows do.
function editorDrawOverlay() {
    const svg = document.getElementById('buildOverlay');
    const frame = document.getElementById('plateFrame');
    const showing = editorCurrent.on && editorOffered();
    if (frame) frame.classList.toggle('building', showing);
    if (!svg) return;
    if (!showing) { svg.innerHTML = ''; return; }
    const f = (value) => value.toFixed(4);
    const cross = editorCurrent.cross;
    let ink = `<path d="M ${f(cross.x - 0.03)} ${f(cross.y)} H ${f(cross.x + 0.03)} M ${f(cross.x)} ${f(cross.y - 0.03)} `
        + `V ${f(cross.y + 0.03)}"/>`;
    if (editorCurrent.anchor) ink += editorShapeSvg(sandboxShapeFromDrag(editorCurrent.tool, editorCurrent.anchor, cross, editorCurrent));
    // The brush shows its own size at the crosshair, the way a paint program's
    // cursor does: it is where the next dab lands, never a shape left behind.
    if (editorCurrent.tool === 'brush') ink += editorShapeSvg(sandboxShapeFromDrag('brush', cross, cross, editorCurrent));
    svg.innerHTML = `<g class="under">${ink}</g><g class="over">${ink}</g>`;
}

// The Build card, redrawn after every accepted edit and never during a slider
// drag; a refused drag is redrawn at its release, so the card ends showing the
// layout that is running.
function editorDrawCard(edit) {
    const card = document.getElementById('buildCard');
    const host = document.getElementById('build');
    editorDrawOverlay();
    if (!card || !host) return;
    const offered = editorOffered();
    card.hidden = !offered;
    host.replaceChildren();
    if (!offered) return;

    const layout = appCurrentLayout();
    const coarsest = edit.coarsest();
    // An edit to a copy of the running layout, through the page.
    const change = (mutate, options) => {
        const next = appCurrentLayout();
        mutate(next);
        return edit.apply(next, options);
    };
    // A slider row in a stack. `live` applies under the drag and records one
    // undo step for the whole drag; otherwise the edit is applied on release.
    const slider = (stack, label, min, max, step, value, show, mutate, live) => {
        const { row, slider: input, readout } = pageSliderRow(label, min, max, step, value);
        readout.textContent = show(value);
        let before = null, refused = false;
        input.addEventListener('input', () => {
            const v = Number(input.value);
            readout.textContent = show(v);
            if (!live) return;
            if (!before) before = appCurrentLayout();
            refused = !change((next) => mutate(next, v), { record: false, redraw: false });
        });
        input.addEventListener('change', () => {
            const v = Number(input.value);
            if (!live) { change((next) => mutate(next, v)); return; }
            if (before && JSON.stringify(before) !== JSON.stringify(appCurrentLayout())) edit.remember(before);
            before = null;
            if (refused) edit.redraw();
        });
        stack.append(row);
    };

    host.append(pageGroup('Build', [
        pageButton('Build mode', () => editorToggle(edit), { pressed: editorCurrent.on }),
        pageButton('Undo', () => edit.undo(), { disabled: !edit.canUndo() }),
        pageButton('Reset layout', () => edit.reset()),
    ]));
    // Saving writes a case file; loading reads one back as data.
    const name = pageElement('input');
    name.type = 'text';
    name.value = editorCurrent.saveName;
    name.setAttribute('aria-label', 'Name of the saved case');
    name.addEventListener('input', () => { editorCurrent.saveName = name.value; });
    name.addEventListener('keydown', (event) => event.stopPropagation());
    const file = pageElement('input');
    file.type = 'file';
    file.accept = '.js';
    file.hidden = true;
    file.addEventListener('change', () => { edit.load(file.files[0]); file.value = ''; });
    host.append(pageGroup('Save and load', [
        name,
        pageButton('Save case', () => edit.save(name.value)),
        pageButton('Load case', () => file.click()),
        file,
    ]));
    host.append(pageElement('p', 'note', !editorCurrent.on
        ? 'Turn on build mode, or press g, to draw shapes on the picture.'
        : editorCurrent.tool === 'brush'
            ? 'Drag on the picture to paint, or press x and move the crosshair with w a s d; x again stops.'
            : 'Drag on the picture to draw, or move the crosshair with w a s d and press x twice.'));

    host.append(pageElement('h3', '', 'Draw'));
    host.append(pageGroup('Drawing tool', EDITOR_TOOLS.map((tool) =>
        pageButton(tool, () => { editorCurrent.tool = tool; edit.redraw(); }, { pressed: editorCurrent.tool === tool }))));
    // A pellet is always a solid core in a catalyst shell, so it takes no ink.
    if (editorCurrent.tool !== 'pellet') {
        host.append(pageGroup('What is drawn', SANDBOX_INKS.map((ink) =>
            pageButton(ink, () => { editorCurrent.ink = ink; edit.redraw(); },
                { pressed: editorCurrent.ink === ink, title: EDITOR_INK_TITLES[ink] }))));
    }
    // Two plain sliders on the editor's own state, applied to the next shape
    // and never to a placed one. A region's strength scales the catalyst rate
    // or the porous drag the coefficient sliders set.
    const sizes = pageElement('div', 'sliderStack');
    const own = (label, min, max, step, value, show, set) => {
        const { row, slider: input, readout } = pageSliderRow(label, min, max, step, value);
        readout.textContent = show(value);
        input.addEventListener('input', () => {
            set(Number(input.value));
            readout.textContent = show(Number(input.value));
            editorDrawOverlay();
        });
        sizes.append(row);
    };
    if (editorCurrent.tool === 'capsule' || editorCurrent.tool === 'brush') {
        own('width', 2 / coarsest, 0.5, 1 / coarsest, editorCurrent.width, displayNumberText, (v) => { editorCurrent.width = v; });
    }
    if (editorCurrent.tool === 'pellet') {
        own('shell', 1 / (4 * coarsest), 4 / coarsest, 1 / (4 * coarsest), editorCurrent.shell, displayNumberText,
            (v) => { editorCurrent.shell = v; });
    }
    if (editorCurrent.tool === 'pellet' || editorCurrent.ink === 'catalyst' || editorCurrent.ink === 'porous') {
        own('strength', 0, EDITOR_STRENGTHS.length - 1, 1, EDITOR_STRENGTHS.indexOf(editorCurrent.strength),
            (k) => `×${EDITOR_STRENGTHS[k]}`, (k) => { editorCurrent.strength = EDITOR_STRENGTHS[k]; });
    }
    host.append(sizes);

    host.append(pageElement('h3', '', 'Edges'));
    const edges = pageElement('div', 'buildEdges');
    for (const edge of CASE_PORT_EDGES) {
        edges.append(pageElement('span', 'sliderLabel', edge), pageGroup(`${edge} edge`, [WALL, SYMMETRY].map((type) =>
            pageButton(BOUNDARY_NAMES[type], () => change((next) => { next.edges[edge] = type; }),
                { pressed: layout.edges[edge] === type,
                  title: type === SYMMETRY ? 'a wall the flow slides along' : undefined }))));
    }
    host.append(edges);

    host.append(pageElement('h3', '', 'Inlets and outlets'));
    const along = (value) => displayNumberText(sandboxSnapAlongEdge(value, coarsest));
    layout.ports.forEach((port, k) => {
        const box = pageElement('div', 'buildPort');
        const edgeSelect = pageElement('select');
        edgeSelect.setAttribute('aria-label', 'edge');
        for (const edge of CASE_PORT_EDGES) {
            const option = pageElement('option', '', edge);
            option.value = edge;
            option.selected = edge === port.edge;
            edgeSelect.append(option);
        }
        edgeSelect.addEventListener('change', () => change((next) => { next.ports[k].edge = edgeSelect.value; }));
        box.append(pageGroup(`port ${k + 1}`, [
            edgeSelect,
            ...[INLET, OUTLET].map((type) => pageButton(BOUNDARY_NAMES[type],
                () => change((next) => {
                    next.ports[k].type = type;
                    if (type === INLET && next.ports[k].speed === undefined) {
                        Object.assign(next.ports[k], { speed: 0.5, feedA: 1, feedB: 0 });
                    }
                }), { pressed: port.type === type })),
            pageButton('Remove', () => change((next) => { next.ports.splice(k, 1); })),
        ]));
        const stack = pageElement('div', 'sliderStack');
        slider(stack, 'from', 0, 1, 1 / coarsest, port.from, along,
            (next, v) => { next.ports[k].from = sandboxSnapAlongEdge(v, coarsest); }, false);
        slider(stack, 'to', 0, 1, 1 / coarsest, port.to, along,
            (next, v) => { next.ports[k].to = sandboxSnapAlongEdge(v, coarsest); }, false);
        if (port.type === INLET) {
            // Linear and capped at 1: the sandbox's time step is built in, and
            // at 0.5 a port already asks a Courant number of 2 of it.
            slider(stack, 'speed', 0, 1, 0.05, port.speed, displayNumberText,
                (next, v) => { next.ports[k].speed = v; }, true);
            for (const [key, field] of [['feedA', 'speciesA'], ['feedB', 'speciesB']]) {
                slider(stack, `feed, ${controlsFieldLabel(field)}`, 0, 1, 0.05, port[key], displayNumberText,
                    (next, v) => { next.ports[k][key] = v; }, true);
            }
        }
        box.append(stack);
        host.append(box);
    });
    host.append(pageGroup('Add', [pageButton('Add port', () => {
        const next = appCurrentLayout();
        const port = sandboxNewPort(next, coarsest);
        if (!port) { edit.refuse('Every edge is taken: shorten or remove a port first.'); return; }
        next.ports.push(port);
        edit.apply(next);
    }, { disabled: layout.ports.length >= boundaryPortCount() })]));
}
