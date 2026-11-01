// multigrid.js, by Allen Rakhamimov.
// The V-cycle: restriction and prolongation between two levels and the two
// steps of the Full Approximation Scheme as WGSL, and the order the cycle
// dispatches its kernels in.
//
// Restrict, then fill: restriction writes every coarse interior point, walls
// included, and the coarse boundary fill then overwrites them from the type.

'use strict';

// Restriction and prolongation

// restrict_<tag>: a coarse cell averages its four fine cells, and a coarse face
// the two fine faces along it, so the flux through it is exact and the
// discrete divergence commutes with restriction.
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

// prolong_<tag>: bilinear, 3/4 and 1/4 along a center's axes and along a face,
// a copy or a plain average across one. No bounds or type test: beside a
// boundary the second point is a ghost, whose change the boundary rule set.
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
// Where a fine face lies on a coarse one, the coarse point is named twice with
// a second weight of 0, so every prolongation is the same four-term sum.
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

// f_H = N_H(R v_h) + R r_h, built after the coarse fill. The change has no
// test on the kind of point: a prescribed point comes out 0 by itself, and an
// outflow face must not be forced to 0.
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

// Each step dispatches one kernel per equation through the CycleRunner in
// runtime.js; the kernels themselves are generated in kernels.js.

// One red-black sweep of every field. The constraint row reads no neighbor's
// pressure, so it is relaxed in a single pass.
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

    // The coarsest level is smoothed many times in place of an exact solve,
    // then filled, as every level is before its change is taken.
    runner.setLevel(coarsest);
    runner.measurePeakSpeed(coarsest);
    smooth(runner, coarsest, options.coarseSmooth);
    runner.fillBoundaries(coarsest);

    for (let level = coarsest - 1; level >= 0; level--) {
        runner.setLevel(level + 1);
        computeCoarseChange(runner, level + 1);
        runner.setLevel(level);
        addCoarseChangeToFiner(runner, level);
        runner.measurePeakSpeed(level);
        // The fill leaves the ghosts current: on the finest level for the
        // picture and the next frame, on a coarser one for its change.
        smooth(runner, level, options.postSmooth);
        runner.fillBoundaries(level);
    }
}
