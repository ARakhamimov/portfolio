// verify_vision.js, by Allen Rakhamimov.
// Simulated color vision.
//
// The page previews a color-vision deficiency with a CSS filter over the
// canvas, and saves an image under the same deficiency by applying the matrix
// to the pixels itself. Both read one table in diagnostics.js. Three things
// have to hold:
//
//   1. The table is the source's. The numbers below are written out from
//      Blink's vision_deficiency.cc, which is what Chrome's DevTools emulation
//      applies, and not read from diagnostics.js.
//   2. The preview and the saved image agree. The filter markup carries the
//      table's nine numbers and asks for linear RGB, and the pixel transform is
//      the same matrix applied in linear light, checked against an sRGB
//      transfer function written out here. Applying the matrix to sRGB values
//      directly darkens a saturated red, and that is the positive control.
//   3. 'normal' changes nothing, and alpha is never touched.
//
// Not checked: whether a browser renders the CSS filter as Chrome does, which
// is seen on the page, or whether Machado's model is right about anyone's
// vision. The page claims only that it shows what DevTools shows.

// verify.html loads it, then runs the body it registers.
verifyCheck('verify_vision.js', function (process) {
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

// Blink, vision_deficiency.cc, the first three rows of each feColorMatrix.
const BLINK = {
    protanopia:    [0.152, 1.053, -0.205, 0.115, 0.786, 0.099, -0.004, -0.048, 1.052],
    deuteranopia:  [0.367, 0.861, -0.228, 0.280, 0.673, 0.047, -0.012, 0.043, 0.969],
    tritanopia:    [1.256, -0.077, -0.179, -0.078, 0.931, 0.148, 0.005, 0.691, 0.304],
    achromatopsia: [0.213, 0.715, 0.072, 0.213, 0.715, 0.072, 0.213, 0.715, 0.072],
};

// The sRGB transfer function, written here and not taken from the file.
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const clamp = (x) => Math.min(1, Math.max(0, x));

function expected(rgb, m) {
    const l = rgb.map((c) => toLinear(c / 255));
    return [0, 1, 2].map((row) => Math.round(255 * toSrgb(clamp(
        m[3 * row] * l[0] + m[3 * row + 1] * l[1] + m[3 * row + 2] * l[2]))));
}

function main() {
const names = diagnosticsVisionNames();

section('THE TABLE IS BLINK\'S', () => {
    check('the first choice is normal vision', names[0] === 'normal');
    check('normal carries no matrix', diagnosticsVisionMatrix('normal') === null);
    check('every deficiency Blink defines is offered, and nothing else',
        names.slice(1).sort().join() === Object.keys(BLINK).sort().join(), names.join());
    for (const [name, values] of Object.entries(BLINK)) {
        const flat = diagnosticsVisionMatrix(name).flat();
        check(`${name}: nine entries equal Blink's`,
            flat.length === 9 && flat.every((v, k) => v === values[k]), flat.join(' '));
    }
    let raised = false;
    try { diagnosticsVisionMatrix('mauve'); } catch (error) { raised = true; }
    check('an unknown name raises rather than falling back to normal', raised);
    console.log(`  ${names.length - 1} deficiencies, each against the source's numbers`);
});

section('THE PREVIEW AND THE SAVED IMAGE AGREE', () => {
    check('normal writes no filter', diagnosticsVisionFilterMarkup('normal') === '');
    for (const [name, values] of Object.entries(BLINK)) {
        const markup = diagnosticsVisionFilterMarkup(name);
        check(`${name}: the filter works in linear RGB`,
            markup.includes('color-interpolation-filters="linearRGB"'));
        check(`${name}: the filter's id is the one the page points at`,
            markup.includes(`id="vision-${name}"`));
        const numbers = (markup.match(/values="([^"]*)"/) || [, ''])[1].trim().split(/\s+/).map(Number);
        const rows = [0, 1, 2].map((r) => numbers.slice(5 * r, 5 * r + 3)).flat();
        check(`${name}: the filter carries the table's nine numbers`,
            numbers.length === 20 && rows.every((v, k) => v === values[k]), numbers.join(' '));
        check(`${name}: the filter keeps alpha and adds no offset`,
            numbers.length === 20 && [3, 4, 8, 9, 13, 14].every((k) => numbers[k] === 0)
            && numbers.slice(15).join() === '0,0,0,1,0');
    }

    // Saturated primaries, a gray, black, white and a mid mixture, each with
    // an alpha that must come back unchanged.
    const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255], [128, 128, 128],
        [0, 0, 0], [255, 255, 255], [200, 120, 30]];
    let compared = 0;
    for (const [name, values] of Object.entries(BLINK)) {
        const pixels = new Uint8ClampedArray(colors.length * 4);
        colors.forEach((c, k) => pixels.set([...c, 17 + k], 4 * k));
        diagnosticsSimulateVision(pixels, name);
        colors.forEach((c, k) => {
            const want = expected(c, values);
            const got = Array.from(pixels.slice(4 * k, 4 * k + 3));
            check(`${name}: (${c}) maps as the matrix in linear light says`,
                got.every((v, i) => v === want[i]), `got ${got}, expected ${want}`);
            check(`${name}: alpha untouched at (${c})`, pixels[4 * k + 3] === 17 + k);
            compared++;
        });
    }

    // The positive control. Applied to sRGB values, protanopia sends pure red
    // to 0.152 * 255, about 39; applied in linear light, to about 109.
    const red = new Uint8ClampedArray([255, 0, 0, 255]);
    diagnosticsSimulateVision(red, 'protanopia');
    const naive = Math.round(255 * 0.152);
    check('protanopia: pure red is not darkened as an sRGB-space product would darken it',
        Math.abs(red[0] - naive) > 40, `red channel ${red[0]} against ${naive}`);
    console.log(`  ${compared} pixels against the matrix applied in linear light;`);
    console.log(`  pure red under protanopia keeps ${red[0]} in its red channel (${naive} if applied to sRGB)`);
});

section('NORMAL VISION CHANGES NOTHING', () => {
    const pixels = new Uint8ClampedArray(256 * 4);
    for (let k = 0; k < pixels.length; k++) pixels[k] = (k * 37) % 256;
    const before = Array.from(pixels);
    diagnosticsSimulateVision(pixels, 'normal');
    check('every byte unchanged under normal vision', pixels.every((v, k) => v === before[k]));
    for (let k = 0; k < 256; k++) {
        const c = k / 255;
        if (Math.abs(diagnosticsSrgbFromLinear(diagnosticsLinearFromSrgb(c)) - c) > 1e-12) {
            failures.push(`transfer function does not invert at ${k}`);
            return;
        }
        passCount++;
    }
    console.log('  256 bytes unchanged; the transfer function inverts at every byte value');
});

heading('RESULT');
console.log(`  ${passCount} checks passed.`);
if (failures.length) {
    console.log(`  ${failures.length} FAILED:`);
    for (const f of failures.slice(0, 40)) console.log(`    ${f}`);
}
process.exitCode = failures.length === 0 ? 0 : 1;
}

main();
});
