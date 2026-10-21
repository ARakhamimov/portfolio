// verify_page.js, by Allen Rakhamimov.
// The page's refresh, for every case and view, against a stub document.
//
// Only that nothing throws is checked; what the panel says is
// verify_equations.js, and what the editor does is verify_sandbox.js.

// verify.html loads it, then runs the body it registers.
verifyCheck('verify_page.js', function (process) {
'use strict';

let failures = 0;
const fail = (message) => { console.log(`  FAIL  ${message}`); failures++; };

// The page's panel, legends and button states are host code that no other check
// runs, and a name missing from a function's scope throws only when the page
// refreshes. So the page's refresh (controlsRefresh, then the two panels) runs
// here for every preset and every view it offers, with the arrows, streamlines
// and hatching off and on, against a stub document that accepts any element
// and property. The sandbox's Build card and
// overlay are drawn the same way, for every tool, with build mode off and on
// and a shape half drawn, and its keys are pressed in turn. Only that nothing
// throws is checked: what the panel says is verify_equations, and what the
// editor does is verify_sandbox, through the functions the editor calls.
console.log('');
console.log('THE PANEL REFRESHES FOR EVERY CASE AND VIEW');
{
    const element = () => new Proxy(function () {}, {
        get(target, key) {
            if (key === 'style' || key === 'dataset') return target[key] || (target[key] = {});
            if (key === 'children' || key === 'childNodes') return [];
            if (key === 'querySelectorAll') return () => [];
            if (key === Symbol.toPrimitive) return () => '';
            return key in target ? target[key] : element();
        },
        set(target, key, value) { target[key] = value; return true; },
        apply() { return element(); },
    });
    // The stub stands in for the page's document while the loop runs, and the
    // real methods are put back after it, whatever happens.
    const elements = {};
    const stub = {
        getElementById: (id) => elements[id] || (elements[id] = element()),
        querySelectorAll: () => [], querySelector: () => element(),
        createElement: () => element(), createElementNS: () => element(),
        body: element(), documentElement: element(),
    };
    const saved = Object.keys(stub).map((key) => [key, Object.getOwnPropertyDescriptor(document, key)]);
    for (const key of Object.keys(stub)) {
        Object.defineProperty(document, key, { value: stub[key], configurable: true, writable: true });
    }
    const refreshEveryCase = () => {
        const errors = [];
        let refreshes = 0, builds = 0;
        for (const preset of casePresets()) {
            appSelectPreset(preset.id);
            const plate = new Plate(MESH_SIZES.indexOf(preset.solver.cells), preset.solver.coarsestCells);
            appGeometry(plate);
            const system = appSystem();
            const options = { paused: false, cyclesPerFrame: 3, preSmooth: 2, postSmooth: 2,
                coarseSmooth: 40, stepsPerFrame: 1 };
            const state = { totalFrames: 0, dispatches: 0, fps: 0, storage: '' };
            const telemetry = { velocityMax: new Float32Array(plate.numLevels) };
            for (const view of viewsOffered(system)) {
                for (const on of [0, 1]) {
                    plate.viewMode[0] = VIEW_NAMES.indexOf(view);
                    plate.arrows[0] = on;
                    plate.streamlines[0] = on;
                    plate.equipotentials[0] = on;
                    plate.accessible[0] = on;
                    try {
                        controlsRefresh(plate, system, options);
                        panelSyncEquations(system);
                        panelRefresh(plate, system, options, state, telemetry);
                        refreshes++;
                    } catch (error) {
                        errors.push(preset.id + ', ' + view + (on ? ', overlays on' : '') + ': ' + error.message);
                    }
                }
            }
            const edit = { apply: () => true, remember() {}, canUndo: () => true, undo() {}, reset() {},
                refuse() {}, redraw() { editorDrawCard(edit); },
                coarsest: () => appCoarsestInterior(), finest: () => plate.interior[0] };
            // Every other case only hides the card, which one draw covers.
            // Read from the editor's own lists, so a new tool or ink is drawn
            // here without an edit.
            const tools = editorOffered() ? EDITOR_TOOLS : [];
            if (!tools.length) { try { editorDrawCard(edit); } catch (error) {
                errors.push(preset.id + ', build card hidden: ' + error.message); } }
            for (const tool of tools) {
                for (const ink of SANDBOX_INKS) {
                    for (const on of [false, true]) {
                        editorReset();
                        Object.assign(editorCurrent, { on, tool, ink,
                            anchor: on ? { x: 0.2, y: 0.3 } : null });
                        try {
                            editorDrawCard(edit);
                            controlsRefresh(plate, system, options);
                            panelSyncEquations(system);
                            panelRefresh(plate, system, options, state, telemetry);
                            builds++;
                        } catch (error) {
                            errors.push(preset.id + ', build card, ' + tool + ', ' + ink
                                + (on ? ', build mode' : '') + ': ' + error.message);
                        }
                    }
                }
            }
            if (tools.length) try {
                editorReset();
                // Through every tool and ink, with a brush stroke and a pellet
                // drawn by the keys on the way.
                for (const key of ['g', 'w', 'a', 's', 'd', 'x', 'D', 'x', 't', 'T', 'q', 'Q', '3', '4',
                    '5', '6', '6', 't', 't', 't', 'x', 'd', 'd', 'x', 't', 'x', 'w', 'x', 'z', 'x',
                    'Escape', 'Escape']) {
                    editorKey({ key, shiftKey: key === 'D', target: null }, edit);
                }
            } catch (error) {
                errors.push(preset.id + ', build keys: ' + error.message);
            }
            editorReset();
        }
        return { refreshes, builds, errors };
    };
    let result;
    try {
        result = refreshEveryCase();
    } finally {
        for (const [key, descriptor] of saved) {
            if (descriptor) Object.defineProperty(document, key, descriptor);
            else delete document[key];
        }
    }
    for (const error of result.errors.slice(0, 10)) fail(`the panel threw for ${error}`);
    if (result.errors.length > 10) fail(`and ${result.errors.length - 10} more`);
    console.log(`  ${result.refreshes} refreshes and ${result.builds} build-card draws, `
        + `${result.errors.length} of them throwing`);
}

console.log(failures === 0
    ? '  No problems found.'
    : `  ${failures} problem(s).`);
process.exitCode = failures === 0 ? 0 : 1;
});
