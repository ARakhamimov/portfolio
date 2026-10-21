// operators.js, by Allen Rakhamimov.
// The velocity's divergence, vorticity and interpolations, as WGSL.
//
// Each difference lands exactly where it is read: a divergence on the cell its
// four faces bound, a vorticity on the corner its two differences straddle.
// The interpolations are plain averages of the points that straddle the target,
// never weighted and never one-sided; advection's upwind bias is its own matter.

'use strict';

// Printed twice, once on the velocity and once on its old level with `Old` on
// each name, since advection reads both and WGSL cannot take an array as a
// parameter. The divergence and vorticity are for the views.
function makeOperatorCode() {
    return makeVelocityOperatorCode('xFace.xVelocity', 'yFace.yVelocity')
        + makeVelocityAveragesCode('xFace.xVelocity', 'yFace.yVelocity', '')
        + makeVelocityAveragesCode('xFace.xVelocityOld', 'yFace.yVelocityOld', 'Old');
}

// A corner is an evaluation point and not a storage location: no array lives
// there. Positive vorticity is clockwise as drawn, since rows count down.
function makeVelocityOperatorCode(u, v) {
    // language=WGSL
    return `
        fn divergenceAtCenter(level : u32, column : u32, row : u32) -> f32 {
            let spacing = grid.spacing[level];
            let changeAlongX = ${u}[indexXFace(level, column + 1u, row)]
                             - ${u}[indexXFace(level, column, row)];
            let changeAlongY = ${v}[indexYFace(level, column, row + 1u)]
                             - ${v}[indexYFace(level, column, row)];
            return (changeAlongX + changeAlongY) / spacing;
        }

        fn vorticityAtCorner(level : u32, column : u32, row : u32) -> f32 {
            let spacing = grid.spacing[level];
            let changeOfYVelocityAlongX = ${v}[indexYFace(level, column, row)]
                                        - ${v}[indexYFace(level, column - 1u, row)];
            let changeOfXVelocityAlongY = ${u}[indexXFace(level, column, row)]
                                        - ${u}[indexXFace(level, column, row - 1u)];
            return (changeOfYVelocityAlongX - changeOfXVelocityAlongY) / spacing;
        }

        fn vorticityAtCenter(level : u32, column : u32, row : u32) -> f32 {
            return 0.25 * (vorticityAtCorner(level, column, row)
                         + vorticityAtCorner(level, column + 1u, row)
                         + vorticityAtCorner(level, column, row + 1u)
                         + vorticityAtCorner(level, column + 1u, row + 1u));
        }
    `;
}

// u and v at a cell from the two faces either side of it, v at an x-face and u
// at a y-face from the four faces around it.
function makeVelocityAveragesCode(u, v, suffix) {
    // language=WGSL
    return `
        fn xFaceToCenter${suffix}(level : u32, column : u32, row : u32) -> f32 {
            return 0.5 * (${u}[indexXFace(level, column, row)]
                        + ${u}[indexXFace(level, column + 1u, row)]);
        }

        fn yFaceToCenter${suffix}(level : u32, column : u32, row : u32) -> f32 {
            return 0.5 * (${v}[indexYFace(level, column, row)]
                        + ${v}[indexYFace(level, column, row + 1u)]);
        }

        fn yFaceToXFace${suffix}(level : u32, column : u32, row : u32) -> f32 {
            return 0.25 * (${v}[indexYFace(level, column - 1u, row)]
                         + ${v}[indexYFace(level, column, row)]
                         + ${v}[indexYFace(level, column - 1u, row + 1u)]
                         + ${v}[indexYFace(level, column, row + 1u)]);
        }

        fn xFaceToYFace${suffix}(level : u32, column : u32, row : u32) -> f32 {
            return 0.25 * (${u}[indexXFace(level, column, row - 1u)]
                         + ${u}[indexXFace(level, column + 1u, row - 1u)]
                         + ${u}[indexXFace(level, column, row)]
                         + ${u}[indexXFace(level, column + 1u, row)]);
        }
    `;
}
