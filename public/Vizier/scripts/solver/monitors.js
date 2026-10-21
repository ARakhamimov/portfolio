// monitors.js, by Allen Rakhamimov.
// What the page watches while a case runs: each field's largest magnitude, the
// peak speed, the heat flux through two walls, and the divergence field.
//
// Each is a kernel writing into the controls buffer (or a field array), and
// MonitorsReader brings the controls buffer back to the host once a second.
// Nothing in the solve reads any of them.

'use strict';

// Field health
//
// The largest magnitude each solved field holds, for the divergence watchdog,
// taken on the bits with the sign masked. A compiler may assume no float is
// NaN and fold a floating-point test for one away; a NaN's bits still beat
// every finite value's.

function makeHealthScanCode(system, equation, arrays) {
    const location = equation.location;
    const indexFunction = indexFunctionAt(location);
    const healthSlot = system.equations.indexOf(equation);
    return marginEntryPoint(`scanHealth_${equation.field}`, location,
        `let p = ${indexFunction}(level, column, row);\n            ` +
        `atomicMax(&controls.fieldHealthBits[${healthSlot}u], bitcast<u32>(${arrays.value}[p]) & 0x7fffffffu);`);
}

function makeHealthResetCode(system) {
    if (system.equations.length > FIELD_HEALTH_SLOTS) {
        throw new Error(`makeHealthResetCode: ${system.equations.length} equations and only ` +
            `${FIELD_HEALTH_SLOTS} health slots; FIELD_SPEC and the system disagree`);
    }
    // language=WGSL
    return `
        @compute @workgroup_size(1)
        fn resetFieldHealth() {
            for (var slot = 0u; slot < ${system.equations.length}u; slot++) {
                atomicStore(&controls.fieldHealthBits[slot], 0u);
            }
        }`;
}

// The largest speed
//
// WGSL has no atomic maximum over floats, so the scan takes atomicMax over the
// bits of the speed. Non-negative floats order the same way as their bits.

// The emitter and the frame loop in runtime.js both ask this, so a system that
// generates no scan never dispatches one.
function monitorsMeasureSpeed(system) {
    return kernelsHasVelocity(system);
}

function makeSpeedScanCode() {
    // language=WGSL
    return `
        @compute @workgroup_size(1)
        fn resetVelocityMax() {
            atomicStore(&controls.velocityMaxBits[controls.computeLevel], 0u);
        }

${interiorEntryPoint('scanVelocityMax', 0, `let p = indexCenter(level, column, row);
            if (grid.typeCenter[p] != FLUID) { return; }
            let xVelocity = xFaceToCenter(level, column, row);
            let yVelocity = yFaceToCenter(level, column, row);
            let speed = sqrt(xVelocity * xVelocity + yVelocity * yVelocity);
            atomicMax(&controls.velocityMaxBits[level], bitcast<u32>(speed));`).trim()}

        @compute @workgroup_size(1)
        fn recordVelocityMax() {
            let level = controls.computeLevel;
            controls.velocityMax[level] = bitcast<f32>(atomicLoad(&controls.velocityMaxBits[level]));
        }`;
}

// The heat flux through two walls
//
// For the Nusselt number: the mean temperature difference across each wall's
// face, over the spacing, along the whole edge. The ghost holds the mirror of
// the wall value, so ghost minus inside is the gradient one face wide. One
// thread walks both edges; an edge is at most a thousand cells.

// The emitter and the frame loop both ask this.
function monitorsMeasureWallHeatFlux(system) {
    return Boolean(system.heatFluxWalls);
}

// The inside cell and its ghost on an edge, k cells along it. Rows are
// numbered from the top.
const MONITOR_EDGE_POINTS = {
    left:   { inside: '1u, k', ghost: '0u, k' },
    right:  { inside: 'cells, k', ghost: 'cells + 1u, k' },
    top:    { inside: 'k, 1u', ghost: 'k, 0u' },
    bottom: { inside: 'k, cells', ghost: 'k, cells + 1u' },
};

function makeWallHeatFluxCode(walls) {
    // Into the fluid at the hot wall, out of it at the cold one, so both are
    // positive when heat crosses the box.
    const across = (edge, sign) => {
        const { inside, ghost } = MONITOR_EDGE_POINTS[edge];
        // language=WGSL
        return `
                let inside_${edge} = indexCenter(level, ${inside});
                if (grid.typeCenter[inside_${edge}] == FLUID) {
                    sum_${edge} += ${sign}(centerState.temperature[indexCenter(level, ${ghost})]
                        - centerState.temperature[inside_${edge}]);
                    count_${edge} += 1.0;
                }`;
    };
    // language=WGSL
    return `
        @compute @workgroup_size(1)
        fn measureWallHeatFlux() {
            let level = 0u;
            let cells = grid.interior[level];
            var sum_${walls.hot} = 0.0;
            var count_${walls.hot} = 0.0;
            var sum_${walls.cold} = 0.0;
            var count_${walls.cold} = 0.0;
            for (var k = 1u; k <= cells; k++) {${across(walls.hot, '')}${across(walls.cold, '-')}
            }
            controls.wallHeatFlux[0] = sum_${walls.hot} / (max(count_${walls.hot}, 1.0) * grid.spacing[level]);
            controls.wallHeatFlux[1] = sum_${walls.cold} / (max(count_${walls.cold}, 1.0) * grid.spacing[level]);
        }`;
}

// The divergence
//
// Shown and never solved for, so it is recomputed on the finest level once a
// frame, from the state the frame ended on.
function makeDivergenceCode() {
    return interiorEntryPoint('computeDivergence', 0, `let p = indexCenter(level, column, row);
            if (grid.typeCenter[p] != FLUID) { centerState.divergence[p] = 0.0; return; }
            centerState.divergence[p] = divergenceAtCenter(level, column, row);`);
}

// The readback
//
// Reads the controls buffer through a staging copy, off the frame path. The
// page says how many heat-flux samples to keep and where a failed read is
// reported.
class MonitorsReader {
    constructor(device, buffer, plate, heatFluxWindow, onError) {
        this.device = device;
        this.buffer = buffer;
        this.plate = plate;
        this.bytes = plate.exportByteOffsetsControls.at(-1);
        this.staging = device.createBuffer({
            size: this.bytes, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        this.speedOffset = plate.controlsByteOffset('velocityMax');
        this.healthOffset = plate.controlsByteOffset('fieldHealthBits');
        this.heatFluxOffset = plate.controlsByteOffset('wallHeatFlux');
        // The wall heat flux, one sample a second while the case runs, for a
        // time-averaged Nusselt number (panelHeatFluxMean).
        this.heatFluxSamples = [];
        this.heatFluxWindow = heatFluxWindow;
        this.onError = onError;
        this.busy = false;
    }

    // Called after a read, only while running, since a paused frame would
    // repeat the last sample.
    sampleHeatFlux() {
        if (!this.wallHeatFlux) return;
        this.heatFluxSamples.push([this.wallHeatFlux[0], this.wallHeatFlux[1]]);
        if (this.heatFluxSamples.length > this.heatFluxWindow) this.heatFluxSamples.shift();
    }

    async read() {
        if (this.busy) return;
        this.busy = true;
        try {
            const encoder = this.device.createCommandEncoder();
            encoder.copyBufferToBuffer(this.buffer, 0, this.staging, 0, this.bytes);
            this.device.queue.submit([encoder.finish()]);
            await this.staging.mapAsync(GPUMapMode.READ);
            const copy = this.staging.getMappedRange().slice(0);
            this.staging.unmap();
            this.velocityMax = new Float32Array(copy, this.speedOffset, this.plate.numLevels);
            // Written as bits for the atomic max and read back as floats: the
            // bits of |x|, so this is the largest magnitude, or NaN or Infinity.
            this.fieldHealth = new Float32Array(copy, this.healthOffset, FIELD_HEALTH_SLOTS);
            this.wallHeatFlux = new Float32Array(copy, this.heatFluxOffset, 2);
        } catch (error) {
            this.onError(`telemetry read failed: ${error.message}`);
        } finally {
            this.busy = false;
        }
    }
}
