// wgslLiterals.js, by Allen Rakhamimov.
// Numbers and colors written as WGSL text, for every file that splices a
// JavaScript value into a shader.
//
// Machinery: nothing here runs on its own. The one rule easy to break: every
// number spliced into WGSL goes through wgslLiteral or wgslNumber, since WGSL
// has no implicit int-to-float conversion and a bare 2 is a type error.

'use strict';

// A whole number gets a decimal point, or the shader will not compile.
function wgslLiteral(value) {
    if (!Number.isFinite(value)) return '0.0';
    return Number.isInteger(value) ? `${value}.0` : `${value}`;
}

// The same, in parentheses when negative, for a number pasted into an
// expression: 2.0 * (-0.4), not 2.0 * -0.4.
function wgslNumber(value) {
    return value < 0 ? `(${wgslLiteral(value)})` : wgslLiteral(value);
}

// A color as [red, green, blue], each 0 to 1.
function wgslColor(color) {
    return `vec3f(${color.map(wgslLiteral).join(', ')})`;
}
