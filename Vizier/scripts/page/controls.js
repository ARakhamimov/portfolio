// controls.js, by Allen Rakhamimov.
// The keyboard map, the coefficient sliders, the button bar, and the refresh
// that keeps the bar and the legend in step with the running case.
//
// Every control goes through controlsActions, so a key and its button call one
// function. What a control does to the rest of the page arrives as a handler
// from page.js (changed, exportRun, buildKey), so this file calls into no
// panel. Nothing in the solver depends on it.

'use strict';

// The simulated color vision on show, one of diagnosticsVisionNames(). Read
// across files through controlsVisionName, since the page saves the image.
let controlsVision = 'normal';
function controlsVisionName() { return controlsVision; }

// A field's label for buttons and messages, under the running case's physics.
function controlsFieldLabel(name, physics = appActivePreset().system.physics) {
    return fieldPresentationOf(name, 'label', physics);
}

// The keyboard

// Each key, what the key table says it does, and the action it takes. All on
// the left of the keyboard, so the map is reachable one-handed; the cycle
// budget is the exception, a developer control. Build mode's own keys are
// editor.js's EDITOR_KEYS and are read before these.
const CONTROL_KEYS = [
    { label: 'space', what: 'pause', press: { ' ': (act) => act.togglePause() } },
    { label: '1 / 2', what: 'cells shown, finer and coarser',
      press: { 1: (act) => act.stepLevel(true), 2: (act) => act.stepLevel(false) } },
    { label: 'v / V', what: 'view, forward and back',
      press: { v: (act) => act.stepViewMode(true), V: (act) => act.stepViewMode(false) } },
    { label: 'r / R', what: 'field in the row under the views',
      press: { r: (act) => act.stepResidualField(true), R: (act) => act.stepResidualField(false) } },
    { label: 's / S', what: 'species shown',
      press: { s: (act) => act.stepViewSpecies(true), S: (act) => act.stepViewSpecies(false) } },
    { label: 'a', what: 'direction arrows', press: { a: (act) => act.toggleArrows() } },
    { label: 'f', what: 'streamlines, where there is a flow', press: { f: (act) => act.toggleStreamlines() } },
    { label: 'e', what: 'equipotentials, or field lines, on the potential and wave views',
      press: { e: (act) => act.toggleEquipotentials() } },
    { label: 'h', what: 'accessible hatching', press: { h: (act) => act.toggleAccessible() } },
    { label: 'b', what: 'bilinear smoothing', press: { b: (act) => act.toggleBilinear() } },
    { label: 'c / C', what: 'simulated color vision',
      press: { c: (act) => act.stepVision(true), C: (act) => act.stepVision(false) } },
    { label: ', / .', what: 'cycles per frame',
      press: { '.': (act) => act.stepCycles(true), ',': (act) => act.stepCycles(false) } },
    { label: 'd', what: 'export run', press: { d: (act) => act.exportRun() } },
    { label: 'g', what: 'build mode, in the sandbox', press: {} },
];

// The key table the panel shows: [key, what it does].
function controlsKeyTable() {
    return CONTROL_KEYS.map(({ label, what }) => [label, what]);
}

// The coefficient sliders

// The sliders this case shows, as [name, label, shape, range], in the bar's
// order. Every slider a case may list is a constant with a slider label
// (COEFFICIENT_SLIDERS): a viewer's names and not the shader's slots, so the
// yield reaches the shader only inside Monod's uptake slot.
function controlsOfferedSliders(preset) {
    const known = COEFFICIENT_SLIDERS.map(({ name }) => name);
    for (const name of Object.keys(preset.sliders)) {
        if (!known.includes(name)) throw new Error(`${preset.id}: no slider is named ${name}`);
    }
    return COEFFICIENT_SLIDERS
        .filter(({ name }) => caseHasSlider(preset, name))
        .map(({ name, slider }) => [name, slider,
            caseSliderMovesLinearly(name) ? 'linear' : 'ratio',
            preset.sliders[name]]);
}

// Redrawn when the case changes and never under a drag, since replacing a
// slider while it is dragged drops the drag.
function controlsDrawCoefficients(apply) {
    const host = document.getElementById('coefficients');
    if (!host) return;
    host.replaceChildren();
    const base = appBasePreset();
    const live = appActivePreset();
    for (const [name, label, shape, range] of controlsOfferedSliders(base)) {
        host.append(controlsSliderRow(name, label, shape, range,
            caseControlValue(base, name), caseControlValue(live, name), apply));
    }
}

// Positions along a ratio slider, spaced evenly in the logarithm so each step
// multiplies the value by the same amount. A temperature steps one degree.
const CONTROL_RATIO_STEPS = 240;

// One row: caption, slider, readout, live under the drag. The position the
// case's own value sits at gives back exactly that value.
function controlsSliderRow(name, label, shape, [low, high], declared, current, apply) {
    const ratio = shape === 'ratio';
    const steps = ratio ? CONTROL_RATIO_STEPS : Math.round(high - low);
    const toLine = (value) => (ratio ? Math.log(value) : value);
    const fromLine = (value) => (ratio ? Math.exp(value) : value);
    const positionOf = (value) => Math.round(steps
        * (toLine(value) - toLine(low)) / (toLine(high) - toLine(low)));
    const declaredPosition = positionOf(declared);
    const valueAt = (position) => (Number(position) === declaredPosition ? declared
        : fromLine(toLine(low) + (toLine(high) - toLine(low)) * Number(position) / steps));
    const { row, slider, readout } = pageSliderRow(label, 0, steps, 1, positionOf(current));
    const show = (value) => { readout.textContent = displayNumberText(value); };

    show(current);
    slider.addEventListener('input', () => {
        const value = valueAt(slider.value);
        show(value);
        apply(name, value);
    });
    return row;
}

// The actions

// The scene is read at call time: a handler bound once would write into the
// previous case's buffer after a rebuild, and one bound per rebuild would stack.
function controlsActions(device, currentScene, options, handlers) {
    // Every controls slot is written by name (grid.js holds the order).
    const write = (name) => {
        const { buffers, plate } = currentScene();
        device.queue.writeBuffer(buffers.controls, plate.controlsByteOffset(name), plate[name]);
    };
    const set = (name, value) => {
        currentScene().plate[name][0] = value;
        write(name);
    };
    const flip = (name) => set(name, currentScene().plate[name][0] ? 0 : 1);
    const views = VIEW_NAMES;

    return {
        togglePause() { options.paused = !options.paused; },

        setViewMode(mode) { set('viewMode', mode); },

        // Through the views this case offers, so a key cannot reach one the bar hides.
        stepViewMode(forward) {
            const { plate, system } = currentScene();
            const offered = viewsOffered(system).map((name) => views.indexOf(name));
            const at = Math.max(0, offered.indexOf(plate.viewMode[0]));
            this.setViewMode(offered[pageWrapIndex(at, offered.length, forward)]);
        },

        setLevel(level) {
            const { plate } = currentScene();
            set('viewLevel', Math.max(0, Math.min(plate.numLevels - 1, level)));
        },

        stepLevel(finer) { this.setLevel(currentScene().plate.viewLevel[0] + (finer ? -1 : 1)); },

        setResidualField(index) { set('viewField', index); },

        stepResidualField(forward) {
            const { plate } = currentScene();
            set('viewField', pageWrapIndex(plate.viewField[0], controlsFieldNames.length, forward));
        },

        setViewSpecies(value) { set('viewSpecies', value); },
        setViewMaterial(value) { set('viewMaterial', value); },

        // Through the species this case offers, then to the species view, since
        // the row shows only there and a change anywhere else would go unseen.
        stepViewSpecies(forward) {
            const { plate } = currentScene();
            const values = controlsSpeciesValues;
            if (!values.length) return;
            const at = Math.max(0, values.indexOf(plate.viewSpecies[0]));
            this.setViewSpecies(values[pageWrapIndex(at, values.length, forward)]);
            this.setViewMode(views.indexOf('species'));
        },

        // Any float slot a display slider owns.
        setDisplayScalar(name, value) { set(name, value); },

        // A fraction of the measured peak speed, 0 to 0.25; zero is off.
        setVelocityCutoff(fraction) { set('velocityCutoff', fraction); },

        // Canvas pixels per CSS pixel, so the hatch period is the one the legend
        // states; re-sent on resize, since the canvas is scaled by CSS.
        syncHatchScale(canvas) {
            if (!canvas || !canvas.clientWidth) return;
            set('hatchScale', canvas.width / canvas.clientWidth);
        },

        toggleAccessible() { flip('accessible'); },
        toggleBilinear() { flip('bilinear'); },
        toggleArrows() { flip('arrows'); },

        // Kept as a preference on a case with nothing to draw, where the key
        // does nothing rather than flip a switch the viewer cannot see.
        toggleStreamlines() {
            if (divergenceFreePair(currentScene().system) === null) return;
            flip('streamlines');
        },

        // Switches to a view that draws the lines, so the change is seen: the
        // potential view for a solved potential, a wave view for a wave
        // function's potential energy.
        toggleEquipotentials() {
            const system = currentScene().system;
            if (viewsOffered(system).includes('potential')) {
                flip('equipotentials');
                this.setViewMode(views.indexOf('potential'));
            } else if (drawPotentialEnergyShape(system)) {
                flip('equipotentials');
                const shown = VIEW_NAMES[currentScene().plate.viewMode[0]];
                if (shown !== 'wave function' && shown !== 'probability density') {
                    this.setViewMode(views.indexOf('wave function'));
                }
            }
        },

        // A CSS filter over the canvas and the legend; the draw shader has no
        // part in it, so nothing is written to the controls buffer.
        setVision(name) {
            diagnosticsVisionMatrix(name);
            controlsVision = name;
        },

        stepVision(forward) {
            const names = diagnosticsVisionNames();
            this.setVision(names[pageWrapIndex(names.indexOf(controlsVision), names.length, forward)]);
        },

        stepCycles(more) {
            options.cyclesPerFrame = more
                ? Math.min(20, options.cyclesPerFrame + 1)
                : Math.max(0, options.cyclesPerFrame - 1);
        },

        exportRun() { if (handlers.exportRun) handlers.exportRun(); },
    };
}

// Install

function controlsInstall(device, currentScene, options, handlers) {
    const act = controlsActions(device, currentScene, options, handlers);
    const changed = () => { if (handlers.changed) handlers.changed(); };

    // A button that keeps focus after a mouse click would take the space bar.
    // Keyboard activation reports detail 0 and keeps its focus, for tabbing.
    document.addEventListener('click', (event) => {
        if (event.detail <= 0) return;
        const target = event.target instanceof Element ? event.target.closest('button') : null;
        if (target) target.blur();
    });

    document.addEventListener('keydown', (event) => {
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        // A focused button already takes space and enter.
        if (event.target instanceof HTMLElement && event.target.tagName === 'BUTTON'
            && (event.key === ' ' || event.key === 'Enter')) return;
        if (handlers.buildKey && handlers.buildKey(event)) {
            event.preventDefault();
            changed();
            return;
        }
        const key = CONTROL_KEYS.find((entry) => event.key in entry.press);
        if (!key) return;
        key.press[event.key](act);
        event.preventDefault();
        changed();
    });

    const on = (id, handler) => {
        const element = document.getElementById(id);
        if (element) element.addEventListener('click', () => { handler(); changed(); });
    };
    on('pause', () => act.togglePause());
    on('accessible', () => act.toggleAccessible());
    on('bilinear', () => act.toggleBilinear());
    on('arrows', () => act.toggleArrows());
    on('streamlines', () => act.toggleStreamlines());
    on('equipotentials', () => act.toggleEquipotentials());

    // Every level the shallowest hierarchy could have, the ones this case lacks
    // disabled rather than absent, so the row does not reflow.
    pageButtonRow('viewLevels', 'size', appViewSizes().map((size) => [String(size), size, () => {
        const level = Array.from(currentScene().plate.interior).indexOf(size);
        if (level >= 0) act.setLevel(level);
        changed();
    }]));

    for (const name of ['hatchPitch', 'hatchDepth', 'arrowPitch', 'contourCount']) {
        const slider = document.getElementById(name);
        if (!slider) continue;
        slider.addEventListener('input', () => {
            act.setDisplayScalar(name, Number(slider.value));
            changed();
        });
    }
    const cutoff = document.getElementById('velocityCutoff');
    if (cutoff) {
        cutoff.addEventListener('input', () => {
            act.setVelocityCutoff(Number(cutoff.value));
            act.setViewMode(VIEW_NAMES.indexOf('velocity'));
            changed();
        });
    }

    const plateCanvas = document.getElementById('plate');
    act.syncHatchScale(plateCanvas);
    window.addEventListener('resize', () => { act.syncHatchScale(plateCanvas); changed(); });

    // The filters come from the same table the saved image is computed from,
    // in one hidden inline svg the CSS filter points at by id.
    let filters = document.getElementById('visionFilters');
    if (!filters) {
        filters = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        filters.id = 'visionFilters';
        filters.setAttribute('aria-hidden', 'true');
        filters.setAttribute('width', '0');
        filters.setAttribute('height', '0');
        filters.style.position = 'absolute';
        document.body.append(filters);
    }
    filters.innerHTML = diagnosticsVisionNames().map(diagnosticsVisionFilterMarkup).join('');
    pageButtonRow('visionRow', 'vision', diagnosticsVisionNames().map((name) =>
        [name, name, () => { act.setVision(name); changed(); }]));

    // The rows whose buttons depend on the case are rebuilt by the refresh,
    // through these, only when their names change.
    controlsRowBuilders.views = (names) => pageButtonRow('viewModes', 'mode', names.map((name) => {
        const mode = VIEW_NAMES.indexOf(name);
        return [name, mode, () => { act.setViewMode(mode); changed(); }];
    }));
    // A species or a field button switches to the view it refines.
    controlsRowBuilders.species = (offered) => pageButtonRow('speciesShown', 'species',
        offered.map(({ field, value }) => [field === null ? 'all' : controlsFieldLabel(field), value, () => {
            act.setViewSpecies(value);
            act.setViewMode(VIEW_NAMES.indexOf('species'));
            changed();
        }]));
    controlsRowBuilders.materials = (offered) => pageButtonRow('materialShown', 'material',
        offered.map(({ label, value }) => [label, value, () => {
            act.setViewMaterial(value);
            act.setViewMode(VIEW_NAMES.indexOf('material'));
            changed();
        }]));
    controlsRowBuilders.fields = (names) => pageButtonRow('residualFields', 'field',
        names.map((name, index) => [controlsFieldLabel(name), index, () => {
            act.setResidualField(index);
            // A per-field view keeps the field; any other view means its residual.
            const mode = currentScene().plate.viewMode[0];
            if (!controlsViewUsesFieldRow(mode) || VIEW_NAMES[mode] === 'residual') {
                act.setViewMode(VIEW_NAMES.indexOf('residual'));
            }
            changed();
        }]));
    controlsSyncRows(currentScene().system, currentScene().plate);
}

// The rows that follow the case
//
// The view row, the species row, the material row and the field row offer
// what the running system can show, from the same lists in views.js and
// draw.js that the shader is generated from. Each is rebuilt only when its
// list changes, so a button is never replaced under a viewer's pointer.

const controlsRowBuilders = { views: null, species: null, materials: null, fields: null };
let controlsViewNames = [];
let controlsMaterialLabels = [];
let controlsSpeciesValues = [];
let controlsFieldNames = [];

function controlsSameList(a, b) {
    return a.length === b.length && a.every((item, index) => item === b[index]);
}

function controlsSyncRows(system, plate) {
    const views = viewsOffered(system);
    if (!controlsSameList(views, controlsViewNames)) {
        controlsViewNames = views;
        if (controlsRowBuilders.views) controlsRowBuilders.views(views);
    }

    const offered = drawOfferedSpecies(system);
    const values = offered.map(({ value }) => value);
    if (!controlsSameList(values, controlsSpeciesValues)) {
        controlsSpeciesValues = values;
        if (controlsRowBuilders.species) controlsRowBuilders.species(offered);
    }

    const materials = drawOfferedMaterials(system);
    const materialValues = materials.map(({ label }) => label);
    if (!controlsSameList(materialValues, controlsMaterialLabels)) {
        controlsMaterialLabels = materialValues;
        if (controlsRowBuilders.materials) controlsRowBuilders.materials(materials);
    }

    const viewName = VIEW_NAMES[plate.viewMode[0]];
    const caption = document.getElementById('residualCaption');
    if (caption) {
        caption.textContent = viewName === 'cell Peclet' ? 'Cell Peclet of'
            : viewName === 'upwind blend' ? 'Upwind blend of' : 'Residual of';
    }
    const fields = viewsFieldRow(system, viewName);
    if (!controlsSameList(fields, controlsFieldNames)) {
        controlsFieldNames = fields;
        if (controlsRowBuilders.fields) controlsRowBuilders.fields(fields);
    }
}

// Whether the field row picks the field this view draws.
function controlsViewUsesFieldRow(mode) {
    return viewsUseFieldRow(VIEW_NAMES[mode]);
}

// A view this case can show: the one asked for if offered, else the first.
function controlsOfferedView(system, mode) {
    const offered = viewsOffered(system);
    return offered.includes(VIEW_NAMES[mode]) ? mode : VIEW_NAMES.indexOf(offered[0]);
}

// A species this case can show: the one asked for if offered, else the mixture.
function controlsOfferedSpecies(system, value) {
    return drawOfferedSpecies(system).some((entry) => entry.value === value) ? value : 0;
}

// The bar, read back from the solver state

// Every button is re-read from the plate and never toggled on click, since a
// rebuild clamps the view level and changes which levels exist.
function controlsSyncButtons(plate, options, system) {
    const mode = plate.viewMode[0];
    const viewName = VIEW_NAMES[mode];
    const press = (button, on) => button.setAttribute('aria-pressed', String(Boolean(on)));
    const each = (id, visit) => {
        const host = document.getElementById(id);
        if (host) for (const button of host.children) visit(button);
    };

    const pause = document.getElementById('pause');
    if (pause) {
        pause.textContent = options.paused ? 'Play' : 'Pause';
        press(pause, options.paused);
    }
    each('viewModes', (button) => press(button, Number(button.dataset.mode) === mode));

    // A sub-row shows only under the view it refines.
    controlsShowRow('speciesShown', 'speciesCaption', viewName === 'species');
    controlsShowRow('materialShown', 'materialCaption',
        viewName === 'material' && drawOfferedMaterials(system).length > 0);
    each('materialShown', (button) =>
        press(button, viewName === 'material' && Number(button.dataset.material) === plate.viewMaterial[0]));
    controlsShowRow('residualFields', 'residualCaption', controlsViewUsesFieldRow(mode));
    each('speciesShown', (button) =>
        press(button, viewName === 'species' && Number(button.dataset.species) === plate.viewSpecies[0]));
    // An index past the end draws the first field, since both shader
    // switches default to it.
    const fieldCount = (document.getElementById('residualFields') || { children: [] }).children.length;
    const drawnField = plate.viewField[0] < fieldCount ? plate.viewField[0] : 0;
    each('residualFields', (button) =>
        press(button, controlsViewUsesFieldRow(mode) && Number(button.dataset.field) === drawnField));

    // Each display slider is disabled while its switch is off.
    const hasStream = divergenceFreePair(system) !== null;
    // A potential to draw lines of: a solved one, or a wave function's
    // potential energy.
    const energy = drawPotentialEnergyShape(system) !== null;
    const hasPotential = viewsOffered(system).includes('potential') || energy;
    const contoursOn = (plate.streamlines[0] && hasStream)
        || (plate.equipotentials[0] && (viewName === 'potential'
            || (energy && (viewName === 'wave function' || viewName === 'probability density'))));
    for (const [name, unit, live] of [['hatchPitch', ' px', plate.accessible[0]],
                                      ['hatchDepth', '', plate.accessible[0]],
                                      ['arrowPitch', ' px', plate.arrows[0]],
                                      ['contourCount', ' lines', contoursOn]]) {
        const slider = document.getElementById(name);
        if (!slider) continue;
        slider.value = String(plate[name][0]);
        slider.disabled = !live;
        const readout = document.getElementById(`${name}Readout`);
        if (readout) readout.textContent = unit ? `${plate[name][0].toFixed(0)}${unit}` : plate[name][0].toFixed(2);
    }
    const cutoff = document.getElementById('velocityCutoff');
    if (cutoff) {
        cutoff.value = String(plate.velocityCutoff[0]);
        const readout = document.getElementById('velocityCutoffReadout');
        if (readout) {
            readout.textContent = plate.velocityCutoff[0] > 0
                ? `${(plate.velocityCutoff[0] * 100).toFixed(0)}% of peak` : 'off';
        }
    }

    // A switch with nothing to draw in this case is disabled, not hidden, so
    // the bar does not reflow, and shown unpressed while the choice is kept.
    for (const [id, on] of [['accessible', plate.accessible[0]], ['bilinear', plate.bilinear[0]],
                            ['arrows', plate.arrows[0]],
                            ['streamlines', plate.streamlines[0] && hasStream],
                            ['equipotentials', plate.equipotentials[0] && hasPotential]]) {
        const button = document.getElementById(id);
        if (button) press(button, on);
    }
    const potentialButton = document.getElementById('equipotentials');
    const potentialLabel = drawLorentzTerm(system) ? 'Field lines' : 'Equipotentials';
    if (potentialButton && potentialButton.textContent !== potentialLabel) {
        potentialButton.textContent = potentialLabel;
    }
    for (const [id, offered, why] of [
        ['streamlines', hasStream, 'This case has no flow, so it has no streamlines'],
        ['equipotentials', hasPotential, 'This case solves no potential']]) {
        const button = document.getElementById(id);
        if (button && button.disabled === offered) {
            button.disabled = !offered;
            button.title = offered ? '' : why;
        }
    }

    each('visionRow', (button) => press(button, button.dataset.vision === controlsVision));
    const filter = controlsVision === 'normal' ? '' : `url(#vision-${controlsVision})`;
    for (const id of ['plate', 'legend']) {
        const element = document.getElementById(id);
        if (element && element.style.filter !== filter) element.style.filter = filter;
    }

    const legend = document.getElementById('legend');
    if (legend) legend.innerHTML = legendHtml(plate, system, appActivePreset(), appCoefficientValues());

    const sizes = Array.from(plate.interior);
    each('viewLevels', (button) => {
        const size = Number(button.dataset.size);
        button.disabled = !sizes.includes(size);
        press(button, size === plate.interior[plate.viewLevel[0]]);
    });
    const resolution = document.getElementById('resolution');
    if (resolution) resolution.value = String(plate.interior[0]);
}

// Shows or hides a row and its caption together, touching the DOM only on a
// change.
function controlsShowRow(rowId, captionId, shown) {
    for (const id of [rowId, captionId]) {
        const element = document.getElementById(id);
        if (element && element.hidden === shown) element.hidden = !shown;
    }
}

// The refresh

// The bar and the legend, read again from the plate. Called on every change
// and once a second with fresh telemetry.
function controlsRefresh(plate, system, options) {
    controlsSyncRows(system, plate);
    controlsSyncButtons(plate, options, system);
}
