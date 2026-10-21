// profiles.js, by Allen Rakhamimov.
// The profiles, weights, layers and seeds a case file writes its declaration
// with.
//
// Machinery: nothing here runs on its own. A profile is a value as a function
// of position, written once as a WGSL expression in position.x and position.y
// (positionProfile, coefficients.js); y runs down the screen. Each number goes
// in through wgslNumber.

'use strict';

// Profiles

// `top` over the upper part of the box and `bottom` under it, split at y = at.
function profileSplit(top, bottom, at = 0.5) {
    return positionProfile(`select(${wgslNumber(top)}, ${wgslNumber(bottom)}, position.y > ${wgslNumber(at)})`);
}

// `left` and `right` of x = at.
function profileSplitX(left, right, at = 0.5) {
    return positionProfile(`select(${wgslNumber(left)}, ${wgslNumber(right)}, position.x > ${wgslNumber(at)})`);
}

// Fully developed channel flow of mean speed `mean`.
function profileParabolic(mean) {
    return positionProfile(`${wgslNumber(1.5 * mean)} * 4.0 * position.y * (1.0 - position.y)`);
}

// A jet in a band of each side wall, the bands offset; outside its band the
// profile is zero, so that stretch of INLET acts as a wall.
function profileOffsetJets(speed, leftLow, leftHigh, rightLow, rightHigh) {
    return profileOnEachWall(speed, -speed, leftLow, leftHigh, rightLow, rightHigh);
}

// A species fed only in its own jet's band.
function profileJetSpecies(leftValue, rightValue, leftLow, leftHigh, rightLow, rightHigh) {
    return profileOnEachWall(leftValue, rightValue, leftLow, leftHigh, rightLow, rightHigh);
}

function profileOnEachWall(left, right, leftLow, leftHigh, rightLow, rightHigh) {
    const inBand = (low, high) => `position.y > ${wgslNumber(low)} && position.y < ${wgslNumber(high)}`;
    const rightWall = `select(0.0, ${wgslNumber(right)}, ${inBand(rightLow, rightHigh)})`;
    const leftWall = `select(0.0, ${wgslNumber(left)}, ${inBand(leftLow, leftHigh)})`;
    return positionProfile(`select(${rightWall}, ${leftWall}, position.x <= 0.5)`);
}

// A weight of one inside a disk and zero outside, for a region feed. The edge
// is hard, so it is plain where the feed lands.
function profileDiskWeight(centerX, centerY, radius) {
    return positionProfile(`select(0.0, 1.0, ${profileDistance(centerX, centerY)} <= ${wgslNumber(radius)})`);
}

// The same for a rectangle [x0, y0, x1, y1], edges included.
function profileRectangleWeight(x0, y0, x1, y1) {
    return positionProfile(`select(0.0, 1.0, ${profileInRectangle([x0, y0, x1, y1])})`);
}

// A shape for a coefficient: one everywhere except `factor` inside a
// rectangle. At least one, since the slot holds the coefficient's least value;
// a patch is kept two coarse cells across, as a carved passage is.
function profilePatchFactor(factor, rect) {
    return positionProfile(`select(1.0, ${wgslNumber(factor)}, ${profileInRectangle(rect)})`);
}

// A layered medium: one outside every patch and each patch's factor inside
// it, a later patch painting over an earlier one.
function profileLayers(patches) {
    return positionProfile(patches.reduce((value, { factor, rect }) =>
        `select(${value}, ${wgslNumber(factor)}, ${profileInRectangle(rect)})`, '1.0'));
}

// The distance from a point, and its square, as WGSL in a profile.
function profileDistance(centerX, centerY) {
    return `sqrt(${profileSquaredDistance(centerX, centerY)})`;
}

function profileSquaredDistance(centerX, centerY) {
    const x = wgslNumber(centerX), y = wgslNumber(centerY);
    return `(position.x - ${x}) * (position.x - ${x}) + (position.y - ${y}) * (position.y - ${y})`;
}

// Inside the rectangle [x0, y0, x1, y1], edges included.
function profileInRectangle([x0, y0, x1, y1]) {
    return `position.x >= ${wgslNumber(x0)} && position.x <= ${wgslNumber(x1)} `
        + `&& position.y >= ${wgslNumber(y0)} && position.y <= ${wgslNumber(y1)}`;
}

// A rectangle as a mask for an initial patch: only the at() half, since
// seeding happens once on the host.
function profileInRect(x0, y0, x1, y1) {
    return (x, y) => x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

// Seeds

// A broken front laid out in front widths, so a coarser test with a scaled
// diffusivity starts from the same picture.
function profileOregonatorSeed(rest, width) {
    const front = 0.5, excited = 8 * width, refractory = 30 * width;
    return [
        { field: 'speciesA', value: rest.X },
        { field: 'speciesB', value: rest.Y },
        { field: 'speciesC', value: rest.Z },
        { field: 'speciesC', value: rest.peak,
          at: profileInRect(front - excited - refractory, 0, front - excited, 0.5) },
        { field: 'speciesA', value: 0.3, at: profileInRect(front - excited, 0, front, 0.5) },
        { field: 'speciesB', value: 0, at: profileInRect(front - excited, 0, front, 0.5) },
    ];
}
