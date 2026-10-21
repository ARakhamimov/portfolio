// multigrid.js, by Allen Rakhamimov.
// The V-cycle: restriction and prolongation between two levels and the two
// steps of the Full Approximation Scheme as WGSL, and the order the cycle
// dispatches its kernels in.
//
// Restrict, then fill: restriction writes every coarse interior point, walls
// included, and the coarse boundary fill then overwrites them from the type.
// The V-cycle at the end orders the dispatches; the FAS steps are two of the
// kernels it dispatches, per equation.

'use strict';

// Restriction and prolongation

// restrict_<tag>, called at the coarse level. A coarse cell averages its four
// fine cells. A coarse face averages the two fine faces along it and takes them
// as they are across it, so the flux through it is exact and the discrete
// divergence commutes with restriction.
function makeRestrictCode(tag, location, array) {
    const fine = (index, column, row) => `${array}[${index}(level - 1u, ${column}, ${row})]`;
    const sums = [
        `0.25 * (${fine('indexCenter', '2u * column - 1u', '2u * row - 1u')}
                         + ${fine('indexCenter', '2u * column', '2u * row - 1u')}
                         + ${fine('indexCenter', '2u * column - 1u', '2u * row')}
                         + ${fine('indexCenter', '2u * column', '2u * row')})`,
        `0.5 * (${fine('indexXFace', '2u * column - 1u', '2u * row - 1u')}
                        + ${fine('indexXFace', '2u * column - 1u', '2u * row')})`,
        `0.5 * (${fine('indexYFace', '2u * column - 1u', '2u * row - 1u')}
                        + ${fine('indexYFace', '2u * column', '2u * row - 1u')})`,
    ];

    // language=WGSL
    return `
        fn restrict_${tag}(level : u32, column : u32, row : u32) -> f32 {
            return ${sums[location]};
        }
    `;
}

// prolong_<tag>: the coarse change at a fine point, bilinear over two coarse
// points along each axis. A center's axis, and a face's axis along the face,
// weigh them 3/4 and 1/4; a face's axis across the face copies the coarse face
// it lies on or averages the two it lies between. `array` is the coarse change,
// read with no bounds test and no test on the type.
function makeProlongCode(tag, location, array) {
    const alongX = location === 1 ? 'coarsePointsAlongFaceNormalAxis' : 'coarsePointsAlongCellLikeAxis';
    const alongY = location === 2 ? 'coarsePointsAlongFaceNormalAxis' : 'coarsePointsAlongCellLikeAxis';
    const index = indexFunctionAt(location);
    const coarse = (x, y) => `${array}[${index}(coarseLevel, alongX.${x}, alongY.${y})]`;

    // language=WGSL
    return `
        fn prolong_${tag}(coarseLevel : u32, column : u32, row : u32) -> f32 {
            let alongX = ${alongX}(column);
            let alongY = ${alongY}(row);
            return alongX.firstWeight * alongY.firstWeight * ${coarse('first', 'first')}
                 + alongX.secondWeight * alongY.firstWeight * ${coarse('second', 'first')}
                 + alongX.firstWeight * alongY.secondWeight * ${coarse('first', 'second')}
                 + alongX.secondWeight * alongY.secondWeight * ${coarse('second', 'second')};
        }
    `;
}

// The two coarse points a fine index reads along one axis, and their weights.
// The first is at (fine + 1) / 2 rounded down; the second sits beside it, on
// the side the fine point is. Where a fine face lies on a coarse one, the
// coarse point is named twice with a second weight of 0, so every prolongation
// is the same four-term sum.
function makeTransferHelperCode() {
    // language=WGSL
    return `
        struct CoarsePointsAlongAxis {
            first : u32,
            second : u32,
            firstWeight : f32,
            secondWeight : f32,
        };

        fn coarsePointsAlongCellLikeAxis(fine : u32) -> CoarsePointsAlongAxis {
            let first = (fine + 1u) / 2u;
            if ((fine & 1u) == 1u) {
                return CoarsePointsAlongAxis(first, first - 1u, 0.75, 0.25);
            }
            return CoarsePointsAlongAxis(first, first + 1u, 0.75, 0.25);
        }

        fn coarsePointsAlongFaceNormalAxis(fine : u32) -> CoarsePointsAlongAxis {
            let first = (fine + 1u) / 2u;
            if ((fine & 1u) == 1u) {
                return CoarsePointsAlongAxis(first, first, 1.0, 0.0);
            }
            return CoarsePointsAlongAxis(first, first + 1u, 0.5, 0.5);
        }
    `;
}

// The Full Approximation Scheme

// buildCoarseRightHandSide_<field>: the coarse right-hand side
// f_H = N_H(R v_h) + R r_h, the coarse operator of the restricted solution plus
// the restricted residual. It runs after the coarse fill, never against
// restricted boundary values.
//
// computeChange_<field>: the change the coarse level made, its solution now
// minus the copy taken when it was restricted, written over that copy. There is
// no test on the kind of point: a prescribed point comes out at 0 by itself,
// and an outflow face must not be forced to 0.
function makeFasCode(equation, arrayNames) {
    const field = equation.field;
    const index = indexFunctionAt(equation.location);
    const { value, rightHandSide, residual, restricted } = arrayNames;

    // language=WGSL
    return `
        fn buildCoarseRightHandSide_${field}(coarseLevel : u32, column : u32, row : u32) {
            let p = ${index}(coarseLevel, column, row);
            if (!isSolvedPoint_${field}(coarseLevel, column, row)) { return; }
            ${rightHandSide}[p] = operator_${field}(coarseLevel, column, row) + ${residual}[p];
        }

        fn computeChange_${field}(level : u32, column : u32, row : u32) {
            let p = ${index}(level, column, row);
            ${restricted}[p] = ${value}[p] - ${restricted}[p];
        }
    `;
}

// The V-cycle, as dispatches
//
// The order of the dispatches a cycle is made of. Each step dispatches one
// kernel per equation through the CycleRunner in runtime.js, which owns the
// compute pass; the kernels themselves are generated in kernels.js.

// One red-black sweep of every field: fill the boundaries, then relax the
// red points and the black points. The pressure row has no diagonal of its
// own, so it is relaxed in a single pass.
function sweep(runner, level) {
    runner.fillBoundaries(level);
    for (const equation of runner.system.equations) {
        if (equation.constraint) {
            runner.dispatchForField('relaxAll', equation, level);
        } else {
            runner.dispatchForField('relaxRed', equation, level);
            runner.dispatchForField('relaxBlack', equation, level);
        }
    }
}

function smooth(runner, level, sweeps) {
    for (let count = 0; count < sweeps; count++) sweep(runner, level);
}

function computeResiduals(runner, level) {
    runner.fillBoundaries(level);
    for (const equation of runner.system.equations) runner.dispatchForField('residualInto', equation, level);
}

function restrictToCoarser(runner, coarser) {
    for (const equation of runner.system.equations) {
        runner.dispatchForField('restrictValue', equation, coarser);
        if (!equation.steady) runner.dispatchForField('restrictHistory', equation, coarser);
        runner.dispatchForField('restrictResidual', equation, coarser);
    }
}

function rememberCoarseSolution(runner, coarser) {
    for (const equation of runner.system.equations) runner.dispatchForField('snapshot', equation, coarser);
}

function buildCoarseRightHandSide(runner, coarser) {
    for (const equation of runner.system.equations) runner.dispatchForField('coarseRightHandSide', equation, coarser);
}

function computeCoarseChange(runner, coarser) {
    for (const equation of runner.system.equations) runner.dispatchForField('change', equation, coarser);
}

function addCoarseChangeToFiner(runner, level) {
    for (const equation of runner.system.equations) runner.dispatchForField('prolongChange', equation, level);
}

// One V-cycle: smooth and restrict on the way down to the coarsest level,
// then bring each coarse change back up and smooth again.
function vCycle(runner, options) {
    const coarsest = runner.plate.numLevels - 1;

    for (let level = 0; level < coarsest; level++) {
        const coarser = level + 1;
        runner.setLevel(level);
        runner.measurePeakSpeed(level);
        smooth(runner, level, options.preSmooth);
        computeResiduals(runner, level);

        // The coarse boundary comes from the case, never from restriction.
        runner.setLevel(coarser);
        restrictToCoarser(runner, coarser);
        runner.fillBoundaries(coarser);
        rememberCoarseSolution(runner, coarser);
        buildCoarseRightHandSide(runner, coarser);
    }

    // The coarsest level is smoothed many times in place of an exact solve.
    runner.setLevel(coarsest);
    runner.measurePeakSpeed(coarsest);
    smooth(runner, coarsest, options.coarseSmooth);

    for (let level = coarsest - 1; level >= 0; level--) {
        runner.setLevel(level + 1);
        computeCoarseChange(runner, level + 1);
        runner.setLevel(level);
        addCoarseChangeToFiner(runner, level);
        runner.measurePeakSpeed(level);
        smooth(runner, level, options.postSmooth);
        runner.fillBoundaries(level);
    }
}
