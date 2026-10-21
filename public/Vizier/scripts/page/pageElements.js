// pageElements.js, by Allen Rakhamimov.
// The page's building blocks: an element, a button, a row of buttons, a
// labeled group, a slider row and a step along a list.
//
// Machinery: nothing here runs on its own, and nothing in the solver reads it.

'use strict';

function pageElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
}

function pageButton(text, onClick, { pressed, disabled, title } = {}) {
    const element = pageElement('button', '', text);
    element.type = 'button';
    if (pressed !== undefined) element.setAttribute('aria-pressed', String(pressed));
    if (disabled) element.disabled = true;
    if (title) element.title = title;
    element.addEventListener('click', onClick);
    return element;
}

// Replaces a row's buttons, one per [text, data value, on press]. The value is
// stored as data-<dataName>, which is what the bar's sync reads back.
function pageButtonRow(hostId, dataName, entries) {
    const host = document.getElementById(hostId);
    if (!host) return;
    host.replaceChildren();
    for (const [text, value, press] of entries) {
        const button = pageElement('button', '', text);
        button.type = 'button';
        button.dataset[dataName] = String(value);
        button.addEventListener('click', press);
        host.append(button);
    }
}

function pageGroup(label, children) {
    const element = pageElement('div', 'segmented');
    element.setAttribute('role', 'group');
    element.setAttribute('aria-label', label);
    element.append(...children);
    return element;
}

// Caption, slider and readout in one row. The caller decides what a position
// means and listens to the slider.
function pageSliderRow(label, min, max, step, value) {
    const row = pageElement('div', 'sliderRow');
    const slider = pageElement('input');
    slider.type = 'range';
    slider.setAttribute('aria-label', label);
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.value = String(value);
    const readout = pageElement('span', 'readout');
    row.append(pageElement('span', 'sliderLabel', label), slider, readout);
    return { row, slider, readout };
}

// Steps a selector one place along and wraps. Named for an index, since
// "cycle" means the multigrid cycle everywhere else.
function pageWrapIndex(current, count, forward) {
    return (current + (forward ? 1 : count - 1)) % count;
}
