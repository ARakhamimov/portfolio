// geometry.js, by Allen Rakhamimov.
// Boundary types, shapes, and how a shape marks the points it covers.
//
// A case's geometry is its edges, ports, solid shapes and painted regions. The
// types here are what a point presents to the solver; what each type means for
// each field is the boundary table in boundary.js.

'use strict';

// Boundary types

// The type a point presents to the solver; what a type means for each field is
// the boundary table in boundary.js. INERT is padding with no neighboring cell,
// which is not the same as unread (combineFaceType).
const FLUID    = 0;
const WALL     = 1;
const INLET    = 2;
const OUTLET   = 3;
const SYMMETRY = 4;
const INERT    = 5;

// In enum order: the labels the page and the legend print, lined up with
// displaySettings.boundaryColors and the switch the draw shader emits from it.
const BOUNDARY_NAMES = ['fluid', 'wall', 'inlet', 'outlet', 'symmetry', 'inert'];

// Shapes

// A circle { centerX, centerY, radius }, a rect { x0, y0, x1, y1 }, a capsule
// { x0, y0, x1, y1, radius } or a stroke { points, radius }, in the unit
// square. Classification and painting both ask these questions of a shape.

function geometryShapeCopy(shape) {
    return shape.points ? { ...shape, points: shape.points.map((q) => ({ x: q.x, y: q.y })) }
        : { ...shape };
}

// The box [x0, y0, x1, y1] that holds the shape.
function geometryShapeBounds(shape) {
    switch (shape.kind) {
        case 'circle':
            return [shape.centerX - shape.radius, shape.centerY - shape.radius,
                shape.centerX + shape.radius, shape.centerY + shape.radius];
        case 'rect':
            return [shape.x0, shape.y0, shape.x1, shape.y1];
        case 'capsule':
            return [Math.min(shape.x0, shape.x1) - shape.radius, Math.min(shape.y0, shape.y1) - shape.radius,
                Math.max(shape.x0, shape.x1) + shape.radius, Math.max(shape.y0, shape.y1) + shape.radius];
        case 'stroke': {
            const xs = shape.points.map((q) => q.x);
            const ys = shape.points.map((q) => q.y);
            return [Math.min(...xs) - shape.radius, Math.min(...ys) - shape.radius,
                Math.max(...xs) + shape.radius, Math.max(...ys) + shape.radius];
        }
    }
    throw new Error(`geometryShapeBounds: unknown shape ${shape.kind}`);
}

// The squared distance from (x, y) to the segment from (x0, y0) to (x1, y1).
function geometrySegmentDistanceSquared(x, y, x0, y0, x1, y1) {
    const alongX = x1 - x0;
    const alongY = y1 - y0;
    const lengthSquared = alongX * alongX + alongY * alongY;
    const fraction = lengthSquared > 0
        ? Math.min(1, Math.max(0, ((x - x0) * alongX + (y - y0) * alongY) / lengthSquared)) : 0;
    const offsetX = x - (x0 + fraction * alongX);
    const offsetY = y - (y0 + fraction * alongY);
    return offsetX * offsetX + offsetY * offsetY;
}

// The pieces a shape is marked as: a stroke is one capsule per segment, so a
// long stroke is scanned piece by piece over small boxes; anything else is
// itself.
function geometryShapePieces(shape) {
    if (shape.kind !== 'stroke') return [shape];
    const points = shape.points;
    const capsule = (from, to) => ({ kind: 'capsule', x0: from.x, y0: from.y, x1: to.x, y1: to.y,
        radius: shape.radius });
    if (points.length === 1) return [capsule(points[0], points[0])];
    return points.slice(1).map((point, k) => capsule(points[k], point));
}

// Whether the shape covers the point, with nothing kept alive: a feature
// narrower than a level's spacing may cover none of that level's points.
function geometryShapeContains(shape, x, y) {
    const radiusSquared = shape.radius * shape.radius;
    switch (shape.kind) {
        case 'circle': {
            const offsetX = x - shape.centerX;
            const offsetY = y - shape.centerY;
            return offsetX * offsetX + offsetY * offsetY <= radiusSquared;
        }
        case 'rect':
            return x >= shape.x0 && x <= shape.x1 && y >= shape.y0 && y <= shape.y1;
        case 'capsule':
            return geometrySegmentDistanceSquared(x, y, shape.x0, shape.y0, shape.x1, shape.y1) <= radiusSquared;
        case 'stroke':
            return geometryShapePieces(shape).some((piece) => geometryShapeContains(piece, x, y));
    }
    throw new Error(`geometryShapeContains: unknown shape ${shape.kind}`);
}

// Marking a geometry

// A case's geometry as data, marked on every level at once from the finished
// lists, and never restricted:
//   edges   the type of each side of the ghost ring, named in screen
//           orientation (top at row 0); a side left out is a wall
//   ports   stretches of the ghost ring typed differently from their edge,
//           each { start, end, type } along the perimeter (boundaryPerimeterOf)
//   solids  shapes in order, each with the type it presents to the fluid, any
//           type FLUID included, so a later one overwrites an earlier one and
//           a carve is a FLUID shape; { kind: 'fill' } covers the interior
//   paints  regions laying down catalyst, porous medium, or bare fluid, which
//           clears both, each { shape, material, strength }
// Edges and ports are marked first, then the solids, then the faces from the
// finished centers, then the paint. The plate keeps what it was marked from.
function addGeometry(plate, geometry) {
    plate.edges = { left: WALL, right: WALL, top: WALL, bottom: WALL, ...geometry.edges };
    plate.ports = (geometry.ports || []).map((port) => ({ ...port }));
    plate.solids = (geometry.solids || []).map(geometrySolid);
    plate.paints = (geometry.paints || []).map(geometryPaint);
    classifyCenters(plate);
    classifyFaces(plate);
    paintMaterials(plate);
}

// A solid in the form it is marked in. A rectangle marks the cells whose
// centers fall inside it, whichever way its corners were given, and a thin one
// is not kept alive, since that would widen a carved passage: keep walls and
// passages two cells wide on the coarsest level. A capsule or a stroke marks
// every cell whose center lies within its radius of the segment or the path.
function geometrySolid(solid) {
    const type = solid.type === undefined ? WALL : solid.type;
    if (solid.kind === 'fill') return { kind: 'fill', type };
    if (solid.kind === 'rect') {
        return { kind: 'rect', type, x0: Math.min(solid.x0, solid.x1), x1: Math.max(solid.x0, solid.x1),
            y0: Math.min(solid.y0, solid.y1), y1: Math.max(solid.y0, solid.y1) };
    }
    if (!['circle', 'capsule', 'stroke'].includes(solid.kind)) {
        throw new Error(`a solid is a circle, a rect, a capsule, a stroke or a fill, not ${solid.kind}`);
    }
    return { ...geometryShapeCopy(solid), type };
}

// Each material is its own layer, so catalyst painted over porous medium makes
// a catalytic bed; within a layer the last region over a point decides its
// strength.
function geometryPaint({ shape, material, strength = 1 }) {
    if (!['catalyst', 'porous', 'bare'].includes(material)) {
        throw new Error(`a painted material is catalyst, porous or bare, not ${material}`);
    }
    if (material !== 'bare' && !(strength > 0)) {
        throw new Error(`a painted ${material} needs a positive strength, not ${strength}`);
    }
    return { shape: geometryShapeCopy(shape), material, strength: material === 'bare' ? 0 : strength };
}

function classifyCenters(plate) {
    plate.typeCenter.fill(FLUID);
    for (let level = 0; level < plate.numLevels; level++) {
        markEdgesAndPorts(plate, level);
        for (const shape of plate.solids) markShape(plate, level, shape);
    }
}

// The ghost ring takes its edge's type, then any port's over it. A corner
// takes the first of left, top, right and bottom; no stencil reads one.
function markEdgesAndPorts(plate, level) {
    const widthCenter = plate.widthCenter[level];
    const heightCenter = plate.heightCenter[level];
    for (let row = 0; row < heightCenter; row++) {
        for (let column = 0; column < widthCenter; column++) {
            const onLeft   = (column === 0);
            const onRight  = (column === widthCenter - 1);
            const onTop    = (row === 0);
            const onBottom = (row === heightCenter - 1);
            if (!onLeft && !onRight && !onTop && !onBottom) continue;

            let type;
            if      (onLeft)   type = plate.edges.left;
            else if (onTop)    type = plate.edges.top;
            else if (onRight)  type = plate.edges.right;
            else               type = plate.edges.bottom;

            const index = plate.indexCenter(level, column, row);
            plate.typeCenter[index] = type;
            if (plate.ports.length === 0) continue;
            const position = positionOf(CENTER, column, row, plate.spacing[level]);
            const perimeter = boundaryPerimeterOf(position.x, position.y);
            for (const port of plate.ports) {
                if (perimeter >= port.start && perimeter <= port.end) plate.typeCenter[index] = port.type;
            }
        }
    }
}

// One shape on one level's interior cells, by where each cell's center is.
function markShape(plate, level, shape) {
    if (shape.kind === 'fill') {
        const interiorCells = plate.interior[level];
        for (let row = 1; row <= interiorCells; row++) {
            for (let column = 1; column <= interiorCells; column++) {
                plate.typeCenter[plate.indexCenter(level, column, row)] = shape.type;
            }
        }
        return;
    }
    for (const piece of geometryShapePieces(keptAlive(plate, shape, level))) {
        for (const index of pointsCovered(plate, CENTER, level, piece, true)) {
            plate.typeCenter[index] = shape.type;
        }
    }
}

// A circle narrower than a level's cell would vanish there and take its
// boundary condition with it, so on that level it covers at least half a
// cell diagonal around its center. The coarse obstacle is then a different
// shape, which costs correction quality and never correctness.
function keptAlive(plate, shape, level) {
    const spacing = plate.spacing[level];
    if (shape.kind !== 'circle' || shape.radius > spacing * Math.SQRT2) return shape;
    return { ...shape, radius: Math.max(shape.radius, spacing * Math.SQRT2 / 2) };
}

// The flat indices of every point of a location on a level whose position
// the piece contains, over the interior or every stored point. A position
// is its index less at most one cell, times the spacing, so the window
// below holds every point the piece's box can.
function pointsCovered(plate, location, level, piece, interiorOnly) {
    const covered = [];
    const spacing = plate.spacing[level];
    const [x0, y0, x1, y1] = geometryShapeBounds(piece);
    const first = interiorOnly ? 1 : 0;
    const lastColumn = interiorOnly ? plate.interiorLastX(location, level) : plate.widthAt(location, level) - 1;
    const lastRow = interiorOnly ? plate.interiorLastY(location, level) : plate.heightAt(location, level) - 1;
    const columnLow = Math.max(first, Math.floor(x0 / spacing));
    const columnHigh = Math.min(lastColumn, Math.ceil(x1 / spacing) + 2);
    const rowLow = Math.max(first, Math.floor(y0 / spacing));
    const rowHigh = Math.min(lastRow, Math.ceil(y1 / spacing) + 2);
    for (let row = rowLow; row <= rowHigh; row++) {
        for (let column = columnLow; column <= columnHigh; column++) {
            const position = positionOf(location, column, row, spacing);
            if (geometryShapeContains(piece, position.x, position.y)) {
                covered.push(plate.indexOf(location, level, column, row));
            }
        }
    }
    return covered;
}

// A face takes its type from the two cells it separates (combineFaceType),
// which covers a domain edge and an obstacle surface alike. The outermost
// faces along a face's normal have one cell and stay INERT.
function classifyFaces(plate) {
    plate.typeXFace.fill(INERT);
    plate.typeYFace.fill(INERT);
    for (let level = 0; level < plate.numLevels; level++) {
        const widthCenter = plate.widthCenter[level];
        const heightCenter = plate.heightCenter[level];
        for (const [location, columnStep, rowStep] of [[XFACE, 1, 0], [YFACE, 0, 1]]) {
            const types = plate.typeArrayOf(location);
            const width = plate.widthAt(location, level);
            const height = plate.heightAt(location, level);
            for (let row = 0; row < height; row++) {
                for (let column = 0; column < width; column++) {
                    const minusColumn = column - columnStep;
                    const minusRow = row - rowStep;
                    if (minusColumn < 0 || minusRow < 0 || column >= widthCenter || row >= heightCenter) continue;
                    const typeMinus = plate.typeCenter[plate.indexCenter(level, minusColumn, minusRow)];
                    const typePlus = plate.typeCenter[plate.indexCenter(level, column, row)];
                    types[plate.indexOf(location, level, column, row)] = combineFaceType(typeMinus, typePlus);
                }
            }
        }
    }
}

// Each painted array, at its own points on every level, from the list of
// regions. A face is in a porous region or not by where the face itself is.
// A region writes only its own material's layer, and bare writes zero to
// every layer.
function paintMaterials(plate) {
    const targets = [
        { location: CENTER, array: plate.paintCatalystCenter, material: 'catalyst' },
        { location: XFACE,  array: plate.paintPorousXFace,    material: 'porous' },
        { location: YFACE,  array: plate.paintPorousYFace,    material: 'porous' },
    ];
    for (const { array } of targets) array.fill(0);
    if (plate.paints.length === 0) return;
    for (let level = 0; level < plate.numLevels; level++) {
        for (const paint of plate.paints) for (const piece of geometryShapePieces(paint.shape)) {
            for (const { location, array, material } of targets) {
                if (paint.material !== material && paint.material !== 'bare') continue;
                for (const index of pointsCovered(plate, location, level, piece, false)) {
                    array[index] = paint.strength;
                }
            }
        }
    }
}

// A face's type from the two cells it separates:
//
//   fluid | fluid  ->  FLUID   relaxed
//   fluid | other  ->  other   a boundary face
//   other | other  ->  other   a ghost face, filled by the same rule
//
// A ghost face tangential to a wall is read by the diffusion stencil of the
// face beside it, so it is typed and filled, and only padding with no cell at
// all is INERT. At a corner between two differently typed edges the minus side
// wins.
function combineFaceType(typeMinus, typePlus) {
    if (typeMinus === FLUID && typePlus === FLUID) return FLUID;
    if (typeMinus === FLUID) return typePlus;
    if (typePlus === FLUID) return typeMinus;
    return typeMinus;
}
