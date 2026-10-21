// diagnostics.js, by Allen Rakhamimov.
// Reads the simulation back off the GPU and describes it: the run export, the
// one download helper every save button uses, and the simulated color vision.
//
// Everything here is a button and never a monitor, since a readback stalls the
// pipeline. A first read can skip the file.

'use strict';

// Describing a field

// How far a field is from its own reflection about the horizontal midline.
// Not zero even in a symmetric case: red-black parity is not mirror invariant,
// so an advected scalar plateaus near 1e-4 at 32 cells.
function diagnosticsMirror(plate, values, location, level) {
    const types = plate.typeArrayOf(location);
    const lastX = plate.interiorLastX(location, level);
    const lastY = plate.interiorLastY(location, level);
    let worst = 0;
    let scale = 0;
    let worstAt = null;

    for (let row = 1; row <= lastY; row++) {
        const mirrorRow = lastY + 1 - row;
        if (mirrorRow < row) continue;
        for (let column = 1; column <= lastX; column++) {
            const p = plate.indexOf(location, level, column, row);
            const q = plate.indexOf(location, level, column, mirrorRow);
            if (types[p] !== 0 || types[q] !== 0) continue;
            const difference = Math.abs(values[p] - values[q]);
            if (difference > worst) { worst = difference; worstAt = [column, row]; }
            scale = Math.max(scale, Math.abs(values[p]));
        }
    }
    return { relative: scale > 0 ? worst / scale : 0, absolute: worst, at: worstAt };
}

function diagnosticsRange(plate, values, location, level) {
    const types = plate.typeArrayOf(location);
    const lastX = plate.interiorLastX(location, level);
    const lastY = plate.interiorLastY(location, level);
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    let count = 0;
    let broken = 0;

    for (let row = 1; row <= lastY; row++) {
        for (let column = 1; column <= lastX; column++) {
            const p = plate.indexOf(location, level, column, row);
            if (types[p] !== 0) continue;
            const value = values[p];
            if (!isFinite(value)) { broken++; continue; }
            if (value < min) min = value;
            if (value > max) max = value;
            sum += value;
            count++;
        }
    }
    return { min, max, mean: count ? sum / count : 0, count, broken };
}

// A coarse ASCII map of one field, for the run export.
function diagnosticsMap(plate, values, location, level, scale, columns = 32) {
    const types = plate.typeArrayOf(location);
    const lastX = plate.interiorLastX(location, level);
    const lastY = plate.interiorLastY(location, level);
    const stepX = Math.max(1, Math.floor(lastX / columns));
    const stepY = Math.max(1, Math.floor(lastY / columns));
    const rows = [];

    for (let row = 1; row <= lastY; row += stepY) {
        let line = '';
        for (let column = 1; column <= lastX; column += stepX) {
            const p = plate.indexOf(location, level, column, row);
            if (types[p] !== 0) { line += '#'; continue; }
            const value = values[p];
            if (!isFinite(value)) { line += '!'; continue; }
            line += String(Math.max(0, Math.min(9, Math.floor((value / scale) * 10))));
        }
        rows.push(line);
    }
    return rows;
}

// Reading the buffers back

// The staging buffers are made per read and destroyed after it: they are the
// size of the whole state, and holding them would double the page's GPU memory.
class StateReader {
    constructor(device, buffers, plate) {
        this.device = device;
        this.buffers = buffers;
        this.plate = plate;
    }

    // A map from array name to a Float32Array laid out as the Plate's own.
    async read() {
        const staging = {};
        const encoder = this.device.createCommandEncoder();
        for (const group of BUFFER_GROUPS) {
            staging[group.name] = this.device.createBuffer({
                label: `${group.name} readback`,
                size: this.plate.bufferBytes(group.name),
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });
            encoder.copyBufferToBuffer(this.buffers[group.name], 0,
                staging[group.name], 0, this.plate.bufferBytes(group.name));
        }
        this.device.queue.submit([encoder.finish()]);

        const fields = {};
        try {
            for (const group of BUFFER_GROUPS) {
                await staging[group.name].mapAsync(GPUMapMode.READ);
                const copy = staging[group.name].getMappedRange().slice(0);
                staging[group.name].unmap();

                const arrays = this.plate.arraysInGroup(group);
                const offsets = this.plate.exportByteOffsets[group.name];
                arrays.forEach((array, index) => {
                    fields[array.name] = new Float32Array(copy, offsets[index], this.plate[array.name].length);
                });
            }
        } finally {
            for (const buffer of Object.values(staging)) buffer.destroy();
        }
        return fields;
    }
}

// The run export

// The fields the report can print, each with the scale its map is drawn in.

const DIAGNOSTIC_FIELDS = [
    { name: 'xVelocity', location: XFACE, scale: 2 },
    { name: 'yVelocity', location: YFACE, scale: 2 },
    { name: 'pressure', location: CENTER, scale: 40 },
    { name: 'temperature', location: CENTER, scale: 140 },
    { name: 'speciesA', location: CENTER, scale: 1.2 },
    { name: 'speciesB', location: CENTER, scale: 1.2 },
    { name: 'speciesC', location: CENTER, scale: 1.2 },
    { name: 'speciesD', location: CENTER, scale: 1.2 },
    { name: 'divergence', location: CENTER, scale: 1e-4 },
];

// The ones this system solves, since a row of zeros nothing computed reads as
// a result; the velocity's divergence wherever there is a velocity.
function diagnosticsFieldsFor(system) {
    if (!system) return DIAGNOSTIC_FIELDS;
    const solved = new Set(system.equations.map((equation) => equation.field));
    return DIAGNOSTIC_FIELDS.filter((spec) =>
        solved.has(spec.name) || (spec.name === 'divergence' && kernelsHasVelocity(system)));
}

async function diagnosticsReport(reader, plate, frameCount, options = {}) {
    const fields = await reader.read();
    const level = 0;
    const lines = [];
    const say = (text) => lines.push(text);

    say('SIMULATION STATE');
    say(`case ${options.caseLabel || 'unknown'}`);
    say(`frames ${frameCount}, interior ${plate.interior[0]}, levels ${plate.numLevels}`);

    // The equations, written by the caller, since this file does not know
    // what a concentration is.
    if (options.equations && options.equations.length) {
        say('');
        for (const line of options.equations) say(`  ${line}`);
    }
    // What a viewer built in the sandbox, which no preset id can recover.
    if (options.layout) {
        say('');
        say(`layout ${options.layout}`);
    }
    say('');
    say('field         min         max         mean        mirror      worst at');

    for (const spec of diagnosticsFieldsFor(options.system)) {
        const values = fields[spec.name];
        if (!values) { say(`${spec.name.padEnd(13)} not present`); continue; }
        const range = diagnosticsRange(plate, values, spec.location, level);
        const mirror = diagnosticsMirror(plate, values, spec.location, level);
        say(`${spec.name.padEnd(13)}${range.min.toExponential(2).padStart(11)} ` +
            `${range.max.toExponential(2).padStart(11)} ${range.mean.toExponential(2).padStart(11)} ` +
            `${mirror.relative.toExponential(2).padStart(11)}  ` +
            `${mirror.at ? mirror.at.join(',') : '-'}` +
            `${range.broken ? `   ${range.broken} NON-FINITE` : ''}`);
    }

    // A map per species the case solves.
    const solved = diagnosticsFieldsFor(options.system).map((spec) => spec.name);
    const maps = (options.maps || DRAW_SPECIES_FIELDS)
        .filter((name) => !options.system || solved.includes(name));
    for (const name of maps) {
        const spec = DIAGNOSTIC_FIELDS.find((f) => f.name === name);
        if (!spec || !fields[name]) continue;
        say('');
        say(`${name}, tenths of ${spec.scale}, # solid, ! non-finite:`);
        for (const row of diagnosticsMap(plate, fields[name], spec.location, level, spec.scale)) {
            say(`  ${row}`);
        }
    }

    return lines.join('\n');
}

// Handing a file to the viewer

// A preset id as a file-name fragment (cylinderWakeMonod becomes
// cylinder-wake-monod), so exports from different cases sort and read apart.
function diagnosticsSlug(text) {
    return String(text)
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

// Takes a Blob or a string. The anchor is attached to the document and the
// object URL revoked on a timer: a detached anchor, or a URL revoked in the
// same task as the click, silently drops the download in Firefox and Safari.
function diagnosticsDownload(content, fileName) {
    const blob = content instanceof Blob
        ? content
        : new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
        anchor.remove();
        URL.revokeObjectURL(url);
    }, 10000);
}

// Simulated color vision
//
// Blink's own matrices (third_party/blink/renderer/core/css/
// vision_deficiency.cc): Machado, Oliveira and Fernandes (2009) at full
// severity for the dichromacies, Rec. 709 luminance for achromatopsia, applied
// in LINEAR RGB as Blink applies them. The preview and the saved image read
// this one table. Each row maps (R, G, B) in linear light to one channel.
const DIAGNOSTIC_VISION = [
    ['normal', null],
    ['protanopia', [
        [ 0.152,  1.053, -0.205],
        [ 0.115,  0.786,  0.099],
        [-0.004, -0.048,  1.052]]],
    ['deuteranopia', [
        [ 0.367,  0.861, -0.228],
        [ 0.280,  0.673,  0.047],
        [-0.012,  0.043,  0.969]]],
    ['tritanopia', [
        [ 1.256, -0.077, -0.179],
        [-0.078,  0.931,  0.148],
        [ 0.005,  0.691,  0.304]]],
    ['achromatopsia', [
        [ 0.213,  0.715,  0.072],
        [ 0.213,  0.715,  0.072],
        [ 0.213,  0.715,  0.072]]],
];

function diagnosticsVisionNames() {
    return DIAGNOSTIC_VISION.map(([name]) => name);
}

function diagnosticsVisionMatrix(name) {
    const found = DIAGNOSTIC_VISION.find(([candidate]) => candidate === name);
    if (!found) throw new Error(`diagnosticsVisionMatrix: no simulated vision named ${name}`);
    return found[1];
}

// The <filter> element the preview applies, written from the table. The page
// puts these in one hidden inline <svg> and points a CSS filter at them by id,
// which every browser honors on an HTML element; a data-URL filter is not.
function diagnosticsVisionFilterMarkup(name) {
    const matrix = diagnosticsVisionMatrix(name);
    if (!matrix) return '';
    const rows = matrix.map((row) => `${row.join(' ')} 0 0`).join(' ');
    return `<filter id="vision-${name}" color-interpolation-filters="linearRGB">`
        + `<feColorMatrix type="matrix" values="${rows} 0 0 0 1 0"/></filter>`;
}

// The sRGB transfer function both ways, which is what linearRGB in an SVG
// filter means.
function diagnosticsLinearFromSrgb(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function diagnosticsSrgbFromLinear(c) {
    return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// RGBA bytes in place, as ImageData holds them. Alpha is left alone, and
// 'normal' leaves every byte as it was.
function diagnosticsSimulateVision(pixels, name) {
    const matrix = diagnosticsVisionMatrix(name);
    if (!matrix) return pixels;
    const linear = new Float64Array(256);
    for (let k = 0; k < 256; k++) linear[k] = diagnosticsLinearFromSrgb(k / 255);
    const encode = (value) => Math.round(255 * diagnosticsSrgbFromLinear(Math.min(1, Math.max(0, value))));
    for (let p = 0; p < pixels.length; p += 4) {
        const red = linear[pixels[p]], green = linear[pixels[p + 1]], blue = linear[pixels[p + 2]];
        for (let channel = 0; channel < 3; channel++) {
            const row = matrix[channel];
            pixels[p + channel] = encode(row[0] * red + row[1] * green + row[2] * blue);
        }
    }
    return pixels;
}
