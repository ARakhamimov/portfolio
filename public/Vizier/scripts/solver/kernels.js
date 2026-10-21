// kernels.js, by Allen Rakhamimov.
// The compute entry points the GPU dispatches, generated from the system.
//
// One emitter per kind of entry point. The set of entry points follows from
// system.equations, so a new field needs no edit here. A first read can skip
// this file: runtime.js and multigrid.js name every kernel they dispatch.

'use strict';

// How every kernel opens
//
// The level it runs at, the point it works on, and one named test of whether
// that point is its to work on.

// Over the interior points of a location: one invocation per interior point,
// so the point is the invocation id moved past the ghost ring.
function interiorEntryPoint(name, location, body) {
    // language=WGSL
    return `
        @compute @workgroup_size(WORKGROUP, WORKGROUP)
        fn ${name}(@builtin(global_invocation_id) id : vec3u) {
            let level = controls.computeLevel;
            let column = id.x + 1u;
            let row = id.y + 1u;
            if (!isInterior${LOCATION_NAMES[location].suffix}(level, column, row)) { return; }
            ${body}
        }`;
}

// Over every stored point, ghost ring included. Launched at the interior
// extent instead, the last rows and columns would keep what they held: no
// error, only a band.
function marginKernels() {
    return ['fill', 'shiftHistory', 'scanHealth'];
}

function marginEntryPoint(name, location, body) {
    // language=WGSL
    return `
        @compute @workgroup_size(WORKGROUP, WORKGROUP)
        fn ${name}(@builtin(global_invocation_id) id : vec3u) {
            let level = controls.computeLevel;
            let column = id.x;
            let row = id.y;
            if (!isStored${LOCATION_NAMES[location].suffix}(level, column, row)) { return; }
            ${body}
        }`;
}

// The entry points of one equation

// A constraint row has no diagonal of its own, so it takes the Schur step
// instead of the dictionary's pointwise solve.
function relaxCall(equation) {
    const field = equation.field;
    return equation.constraint
        ? `relaxConstraint_${field}(level, column, row);`
        : `relax_${field}(level, column, row);`;
}

function makeKernelCode(system, arrayNamesFor, workgroup, levelCount) {
    const entryPoints = [];

    for (const equation of system.equations) {
        const field = equation.field;
        const location = equation.location;
        const arrays = arrayNamesFor(equation);
        const indexFunction = indexFunctionAt(location);

        entryPoints.push(marginEntryPoint(`fill_${field}`, location,
            `fillBoundary_${field}(level, column, row);`));

        // relaxAll_ and not relax_, which the dictionary already defines. The
        // constraint row is swept in one color because it does not read its own
        // unknown at any neighbor, so two colors would compute the same thing.
        if (equation.constraint) {
            entryPoints.push(interiorEntryPoint(`relaxAll_${field}`, location, relaxCall(equation)));
        } else {
            // Every point is launched and the other color returns at once, so
            // the launch is the same for both colors.
            for (const color of ['Red', 'Black']) {
                entryPoints.push(interiorEntryPoint(`relax${color}_${field}`, location,
                    `if (!is${color}(column, row)) { return; }\n            ` + relaxCall(equation)));
            }
        }

        entryPoints.push(interiorEntryPoint(`residualInto_${field}`, location,
            `${arrays.residual}[${indexFunction}(level, column, row)] = residual_${field}(level, column, row);`));

        // No kernel stores N(u): buildCoarseRightHandSide_ uses it in the same pass.

        // Restriction and prolongation are both launched over the coarse level,
        // which bounds the work in either direction.
        entryPoints.push(interiorEntryPoint(`restrictValue_${field}`, location,
            `${arrays.value}[${indexFunction}(level, column, row)] = restrict_${field}Value(level, column, row);`));

        // The coarse old level cancels out of the answer; it is restricted so
        // the coarse operator is the fine one.
        if (!equation.steady) {
            entryPoints.push(interiorEntryPoint(`restrictHistory_${field}`, location,
                `${arrays.history}[${indexFunction}(level, column, row)] = restrict_${field}History(level, column, row);`));
        }

        entryPoints.push(interiorEntryPoint(`restrictResidual_${field}`, location,
            `${arrays.residual}[${indexFunction}(level, column, row)] = restrict_${field}Residual(level, column, row);`));

        // Skips the points the smoother does not own; the fill that follows
        // would overwrite them anyway.
        entryPoints.push(interiorEntryPoint(`prolongChange_${field}`, location,
            `let p = ${indexFunction}(level, column, row);\n            ` +
            `if (!isSolvedPoint_${field}(level, column, row)) { return; }\n            ` +
            `${arrays.value}[p] += prolong_${field}Change(level + 1u, column, row);`));

        entryPoints.push(interiorEntryPoint(`coarseRightHandSide_${field}`, location,
            `buildCoarseRightHandSide_${field}(level, column, row);`));
        entryPoints.push(interiorEntryPoint(`change_${field}`, location,
            `computeChange_${field}(level, column, row);`));

        // Ghosts included, so the old level keeps the boundary that was used.
        if (!equation.steady) {
            entryPoints.push(marginEntryPoint(`shiftHistory_${field}`, location,
                `let p = ${indexFunction}(level, column, row);\n            ${arrays.history}[p] = ${arrays.value}[p];`));
        }

        // Taken after the coarse fill, so the change is exactly zero wherever
        // the boundary is prescribed.
        entryPoints.push(interiorEntryPoint(`snapshot_${field}`, location,
            `let p = ${indexFunction}(level, column, row);\n            ${arrays.restricted}[p] = ${arrays.value}[p];`));

        entryPoints.push(makeHealthScanCode(system, equation, arrays));
    }

    entryPoints.push(makeHealthResetCode(system));

    if (monitorsMeasureSpeed(system)) entryPoints.push(makeSpeedScanCode());
    if (monitorsMeasureWallHeatFlux(system)) entryPoints.push(makeWallHeatFluxCode(system.heatFluxWalls));

    // One kernel per level, run between dispatches to set the level. The host
    // cannot write it mid-pass: queue.writeBuffer is ordered against submitted
    // work and not against an encoder still being built, so every dispatch
    // would see the last level written.
    for (let level = 0; level < levelCount; level++) {
        // language=WGSL
        entryPoints.push(`
        @compute @workgroup_size(1)
        fn setLevel${level}() {
            controls.computeLevel = ${level}u;
        }`);
    }

    if (kernelsHasVelocity(system)) entryPoints.push(makeDivergenceCode());

    return entryPoints.join('\n').replace(/WORKGROUP/g, String(workgroup));
}

// What the system solves

// Whether the system solves a velocity. The velocity's operators, the speed
// scan, the divergence and its array all follow this one test.
function kernelsHasVelocity(system) {
    const solved = new Set(system.equations.map((equation) => equation.field));
    return solved.has('xVelocity') && solved.has('yVelocity');
}
