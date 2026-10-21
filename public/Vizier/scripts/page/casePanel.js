// casePanel.js, by Allen Rakhamimov.
// The case's numbers beside the picture: what a case's declaration and mesh
// make of it (caseSummary), and the tables that say how to read the picture.
//
// Each row is a name, a value and the regime the value puts the case in.
// Nothing in the solver depends on this file.

'use strict';

// What a case makes of itself

// The cell Peclet number |u| h / D, the ratio the advection blend watches.
function caseCellPeclet(speed, spacing, diffusivity) {
    return speed * spacing / diffusivity;
}

// The blend bounded advection applies along one axis, min(1, 2 D / (|u| h)),
// as the shader's advectionBlend computes it, for the panel.
function caseAdvectionBlend(speed, spacing, diffusivity) {
    const cellFlux = Math.abs(speed) * spacing;
    return cellFlux <= 2 * diffusivity ? 1 : 2 * diffusivity / Math.max(cellFlux, 1e-30);
}

// One field's transport at one speed.
function caseEffectiveTransport(speed, spacing, diffusivity) {
    const gamma = caseAdvectionBlend(speed, spacing, diffusivity);
    const effective = diffusivity + (1 - gamma) * Math.abs(speed) * spacing / 2;
    return {
        gamma,
        diffusivity,
        effectiveDiffusivity: effective,
        peclet: caseCellPeclet(speed, spacing, diffusivity),
        effectivePeclet: caseCellPeclet(speed, spacing, effective),
    };
}

function caseSummary(preset, plate, peakSpeed) {
    const spacing = plate.spacing[0];
    const diameter = preset.panel.lengthScale !== undefined ? preset.panel.lengthScale
        : (preset.geometry.solidCircles.length ? 2 * preset.geometry.solidCircles[0].radius : 1);
    // The 1.5 is the parabolic peak; a case with another profile declares its
    // velocity scale.
    const velocityScale = preset.panel.velocityScale !== undefined ? preset.panel.velocityScale
        : Array.isArray(preset.geometry.ports) ? caseFastestPort(preset.geometry.ports)
        : (preset.inlet.velocityX ? 1.5 * preset.inlet.speed : preset.inlet.speed);

    const peakMeasured = Number.isFinite(peakSpeed) && peakSpeed > 0;
    const peak = peakMeasured ? peakSpeed : velocityScale;

    const flow = caseEffectiveTransport(peak, spacing, preset.coefficients.viscosity);
    const species = caseEffectiveTransport(peak, spacing, preset.coefficients.massDiffusivity);

    // The step law only where it was measured to bound anything.
    const lawApplies = flow.peclet <= CASE_STEP_LAW_PECLET
                    && species.peclet <= CASE_STEP_LAW_PECLET;
    const limit = lawApplies
        ? Math.min(caseStabilityStep(preset.coefficients.viscosity, peak),
                   caseStabilityStep(preset.coefficients.massDiffusivity, peak))
        : null;

    // Da = k C L / U on a unit feed, built from the rate the substrate leaves
    // at: a Monod case's growth rate over its yield, and every reaction that
    // consumes the feed, each at the feed temperature.
    const feedFactor = preset.coefficients.temperatureSensitivity > 0
        ? Math.exp(preset.coefficients.temperatureSensitivity
            * (preset.inlet.temperature - preset.coefficients.referenceTemperature))
        : 1;
    const sideFactor = preset.coefficients.sideTemperatureSensitivity > 0
        ? Math.exp(preset.coefficients.sideTemperatureSensitivity
            * (preset.inlet.temperature - preset.coefficients.referenceTemperature))
        : 1;
    const consumption = feedFactor * (preset.coefficients.yieldCoefficient > 0
        ? (preset.coefficients.reactionRate || 0) / preset.coefficients.yieldCoefficient
        : (preset.coefficients.reactionRate || 0))
        + (physicsHasSideReaction(preset) ? sideFactor * preset.coefficients.sideReactionRate : 0);
    const damkohler = velocityScale > 0 ? consumption * diameter / velocityScale : 0;
    // A painted case has no single Damkohler number: bare fluid's, and the
    // catalyst's at strength x1.
    const paintedConsumption = preset.coefficients.yieldCoefficient > 0
        ? (preset.coefficients.paintedReactionRate || 0) / preset.coefficients.yieldCoefficient : (preset.coefficients.paintedReactionRate || 0);
    const paintedDamkohler = preset.paintable && consumption > 0 && velocityScale > 0
        ? paintedConsumption * diameter / velocityScale : null;

    // Mixing against convection, with the diffusivity the mesh delivers at the
    // peak speed.
    const mixingTime = species.effectiveDiffusivity > 0
        ? diameter * diameter / species.effectiveDiffusivity : Infinity;

    return {
        // Which numbers the case's own equations define; the panel prints
        // only those.
        hasFlow: physicsHasFlow(preset),
        // The potential's height against the packet's mean energy k^2 / 2.
        potentialOverEnergy: preset.initial.packets.length && preset.coefficients.potentialShape
            ? preset.coefficients.potentialHeight
                / (0.5 * (preset.initial.packets[0].kx ** 2 + preset.initial.packets[0].ky ** 2)) : null,
        // A wave packet's starting wavelength, 2 pi / |k|, in cells.
        wavelengthCells: preset.initial.packets.length
            ? 2 * Math.PI / Math.hypot(preset.initial.packets[0].kx, preset.initial.packets[0].ky) / spacing : null,
        // An Oregonator front is about sqrt(D / k_c) wide; in cells.
        frontCells: preset.system.physics === 'oregonator'
            ? Math.sqrt(preset.coefficients.massDiffusivity / PHYSICS_OREGONATOR.stepC) / spacing : null,
        momentumAdvects: physicsHasFlow(preset) && !physicsIsPorous(preset),
        hasSpecies: physicsHasFlow(preset) && preset.system.transportsSpecies,
        hasTemperature: preset.system.physics === 'conduction'
            || ((physicsHasFlow(preset) || preset.system.physics === 'permeation')
                && physicsSolvesTemperature(preset)),
        // Rayleigh, only where the buoyant field is the temperature.
        rayleigh: physicsHasFlow(preset) && preset.coefficients.buoyancy > 0
            && preset.system.buoyantField && preset.system.buoyantField.field === 'temperature'
            ? preset.coefficients.buoyancy * preset.panel.temperatureDifference * diameter ** 3
                / (preset.coefficients.viscosity * preset.coefficients.thermalDiffusivity) : null,
        prandtl: preset.coefficients.viscosity / preset.coefficients.thermalDiffusivity,
        heatFluxWalls: physicsHeatFluxWalls(preset) !== null,
        porous: physicsIsPorous(preset),
        permeability: preset.coefficients.permeability,
        // A fouled bed has a range of permeability, not one value.
        permeabilityLow: preset.coefficients.fouledPatch
            ? preset.coefficients.permeability / preset.coefficients.fouledPatch.factor : null,
        // The Brinkman layer sqrt(K), in cells, in the open bed and in the
        // plugged patch.
        screeningCells: preset.system.porous === 'brinkman'
            ? Math.sqrt(preset.coefficients.permeability) / spacing : null,
        screeningCellsLow: preset.system.porous === 'brinkman' && preset.coefficients.fouledPatch
            ? Math.sqrt(preset.coefficients.permeability / preset.coefficients.fouledPatch.factor) / spacing : null,

        peak,
        peakMeasured,
        velocityScale,
        cellsAcross: diameter / spacing,

        damkohler,
        paintedDamkohler,
        // Painted porous medium: its permeability at x1, and its Brinkman
        // layer in cells at strengths x1 and x8.
        paintedPermeability: preset.paintable ? preset.coefficients.porousPermeability : null,
        paintedScreeningCells: preset.paintable
            ? [1, 8].map((strength) => Math.sqrt(preset.coefficients.porousPermeability / strength) / spacing) : null,
        mixingToConvection: mixingTime / (diameter / velocityScale),

        reynolds: velocityScale * diameter / preset.coefficients.viscosity,
        // A conducting fluid's magnetic Reynolds number U d / eta, interaction
        // parameter B0^2 d / (eta U) and Hartmann number B0 d / sqrt(nu eta).
        magneticReynolds: preset.system.physics === 'mhd' ? velocityScale * diameter / preset.coefficients.magneticDiffusivity : null,
        interaction: preset.system.physics === 'mhd'
            ? preset.coefficients.appliedField ** 2 * diameter / (preset.coefficients.magneticDiffusivity * velocityScale) : null,
        hartmann: preset.system.physics === 'mhd'
            ? preset.coefficients.appliedField * diameter / Math.sqrt(preset.coefficients.viscosity * preset.coefficients.magneticDiffusivity)
            : null,
        // The speed at which a driven core's u x B cancels the applied E0.
        driveSpeed: preset.system.physics === 'mhd' && preset.coefficients.appliedElectricField > 0
            ? preset.coefficients.appliedElectricField / preset.coefficients.appliedField : null,
        effectiveReynolds: velocityScale * diameter / flow.effectiveDiffusivity,

        cellPeclet: flow.peclet,
        effectiveCellPeclet: flow.effectivePeclet,
        speciesPeclet: species.peclet,
        effectiveSpeciesPeclet: species.effectivePeclet,

        blended: flow.gamma < 1 || species.gamma < 1,
        effectiveViscosity: flow.effectiveDiffusivity,
        effectiveMassDiffusivity: species.effectiveDiffusivity,

        stepLawApplies: lawApplies,
        stepLimit: limit,
        stepMargin: limit === null ? null : limit / preset.solver.timeStep,
    };
}

// The step law

// K in the step law dt < K D / (theta u^2). It belongs to the advection entry's
// split between numerator and denominator, not to any one case.
const CASE_STEP_CONSTANT = 150;

// Above this nominal cell Peclet number the step law was measured not to bound
// anything, and the panel names the regime instead.
const CASE_STEP_LAW_PECLET = 10;

// D is the diffusivity under the advected field, so a species with a small
// mass diffusivity is bound before the momentum rows are.
function caseStabilityStep(diffusivity, speed) {
    return CASE_STEP_CONSTANT * diffusivity / (CASE_THETA * speed * speed);
}

// The tables

// Each row is [name, value, word, flag]: the word names the regime the value
// is in, and the flag, 'on' or 'off', colors it. Both may be left out. The
// word shares the value's cell, so it moves under the value when the line is
// full instead of pushing the table past the card.
function panelFillTable(element, rows) {
    if (!element) return;
    element.innerHTML = rows
        .map(([key, value, word, flag]) => `<tr><td class="k">${key}</td><td class="v">`
            + (word ? `<span class="reading"><span>${value}</span><span class="w ${flag || ''}">${word}</span></span>`
                : value)
            + '</td></tr>')
        .join('');
}

// The Nusselt number's average: a window of one-second samples, long enough to
// span several turnovers of an unsteady box.
const PANEL_HEAT_FLUX_WINDOW = 30;

// The mean of each wall's samples, as Nusselt numbers: the gradient times the
// box over the temperature difference, so pure conduction across the box is 1.
function panelHeatFluxMean(samples, preset) {
    if (!samples || !samples.length) return null;
    const scale = (preset.panel.lengthScale ?? 1) / preset.panel.temperatureDifference;
    const mean = (k) => scale * samples.reduce((sum, sample) => sum + sample[k], 0) / samples.length;
    return { hot: mean(0), cold: mean(1), seconds: samples.length };
}

// Which side of one the reaction sits on, in a word or two. It belongs in the
// panel and not in a note because it moves when the viewer changes a case.
function panelRegime(damkohler) {
    if (damkohler < 0.3) return 'reaction-limited';
    if (damkohler < 3) return 'comparable';
    return 'mixing-limited';
}

// Resolved where a length spans at least so many cells, flagged otherwise.
function panelResolved(cells, least) {
    return cells < least ? ['under-resolved', 'off'] : ['resolved', 'on'];
}

// A requested number and the one the mesh delivers at the peak speed, where
// the blend is active; the requested one alone where it is not.
function panelAtPeak(requested, atPeak, digits, blended) {
    return blended ? `${panelFixed(requested, digits)}, ${panelFixed(atPeak, digits)} at peak`
        : panelFixed(requested, digits);
}

// The tables of the panel. The short one is what a viewer needs to trust the
// picture; the rest are developer readouts. A row appears only where the
// case's own equations define the number it reports: no Reynolds number
// without a momentum row, no cell Peclet number without an advection term.
function panelRefresh(plate, system, options, state, telemetry) {
    const preset = appActivePreset();
    const peak = telemetry.velocityMax ? telemetry.velocityMax[0] : NaN;
    const summary = caseSummary(preset, plate, peak);
    panelFillTable(document.getElementById('caseState'), panelCaseState(plate, preset, summary,
        panelHeatFluxMean(telemetry.heatFluxSamples, preset)));
    panelFillTable(document.getElementById('caseDetail'), panelCaseDetail(preset, summary));
    const level = plate.viewLevel[0];
    const view = VIEW_NAMES[plate.viewMode[0]];
    const viewRows = [['level', `${level} of ${plate.numLevels - 1}, ${plate.interior[level]}<sup>2</sup> cells, `
        + `spacing ${plate.spacing[level].toExponential(2)}`]];
    if (viewsUseFieldRow(view)) viewRows.push(['field', controlsFieldNames[plate.viewField[0]] || '-']);
    panelFillTable(document.getElementById('viewState'), viewRows);
    panelFillTable(document.getElementById('solverState'), [
        ['frames', `${state.totalFrames}, ${state.fps} fps`, options.paused ? 'paused' : 'running',
            options.paused ? 'off' : 'on'],
        ['V-cycles', `${options.cyclesPerFrame} a time step, ${options.preSmooth} sweeps down, `
            + `${options.postSmooth} up, ${options.coarseSmooth} on the coarsest level`],
        ['time step', `${appTimeStep().toExponential(2)}, ${options.stepsPerFrame} a frame, &theta; ${appTheta()}`],
        ['GPU dispatches', `${state.dispatches} a frame`],
        ['GPU memory', `${state.storage} MiB`],
    ]);
    const levels = [];
    for (let level = 0; level < plate.numLevels; level++) {
        const speed = telemetry.velocityMax ? telemetry.velocityMax[level] : NaN;
        levels.push([`${plate.interior[level]} cells`, Number.isFinite(speed) ? displayNumberText(speed) : '-',
            ...(level === plate.viewLevel[0] ? ['shown'] : [])]);
    }
    // The speed per level, only where there is a speed.
    const levelTable = document.getElementById('levelState');
    const flows = kernelsHasVelocity(system);
    if (levelTable) {
        levelTable.hidden = !flows;
        if (levelTable.previousElementSibling) levelTable.previousElementSibling.hidden = !flows;
    }
    if (flows) panelFillTable(levelTable, levels);
    // In build mode its keys come first and the ones they shadow are left out.
    const keys = editorCurrent.on && editorOffered()
        ? [...EDITOR_KEYS, ...controlsKeyTable().filter(([key]) => !EDITOR_SHADOWED.includes(key))]
        : controlsKeyTable();
    panelFillTable(document.getElementById('keyState'), keys.map(([key, what]) => [`<kbd>${key}</kbd>`, what]));
}

// The case's own numbers, each with the regime it puts the case in. Reynolds
// is given as requested and at the peak speed, which is the worst case in the
// domain since the blend is local; a case that asks for zero viscosity asks
// for an infinite Reynolds number.
function panelCaseState(plate, preset, summary, nusselt = null) {
    const rows = [];

    if (summary.hasFlow) {
        rows.push(['Reynolds', panelAtPeak(summary.reynolds, summary.effectiveReynolds, 0, summary.blended),
            ...(summary.blended ? ['mesh-limited', 'off'] : ['resolved', 'on'])]);
    }
    if (summary.rayleigh !== null) {
        rows.push(['Rayleigh', `${displayNumberText(summary.rayleigh)}, Prandtl ${displayNumberText(summary.prandtl)}`]);
    }
    if (summary.heatFluxWalls) rows.push(panelNusseltRow(nusselt));
    if (summary.porous) {
        const range = summary.permeabilityLow !== null
            ? `${summary.permeability.toExponential(1)} to ${summary.permeabilityLow.toExponential(1)}`
            : summary.permeability.toExponential(1);
        if (summary.screeningCells === null) {
            rows.push(['permeability', range, 'Darcy only']);
        } else {
            const thinnest = summary.screeningCellsLow ?? summary.screeningCells;
            rows.push(['permeability', `${range}, wall layer ${thinnest.toFixed(1)} cells`,
                ...panelResolved(thinnest, 2)]);
        }
    }
    if (summary.magneticReynolds !== null) {
        rows.push(['magnetic Reynolds', displayNumberText(summary.magneticReynolds),
            summary.magneticReynolds < 1 ? 'field slips' : 'field carried']);
        rows.push(['interaction', displayNumberText(summary.interaction),
            summary.interaction < 0.3 ? 'inertia wins' : summary.interaction < 3 ? 'comparable' : 'field wins']);
        rows.push(['Hartmann', displayNumberText(summary.hartmann),
            summary.hartmann < 3 ? 'round profile' : 'flat core']);
    }
    if (summary.driveSpeed !== null) rows.push(['drive speed E₀/B₀', displayNumberText(summary.driveSpeed)]);
    if (summary.wavelengthCells !== null) {
        rows.push(['wavelength', `${summary.wavelengthCells.toFixed(1)} cells`,
            ...panelResolved(summary.wavelengthCells, 8)]);
    }
    if (summary.potentialOverEnergy !== null) {
        rows.push(['potential height', `${displayNumberText(summary.potentialOverEnergy)} x packet energy`]);
    }
    if (summary.frontCells !== null) {
        rows.push(['front width', `${summary.frontCells.toFixed(1)} cells`, ...panelResolved(summary.frontCells, 1)]);
    }
    // The number that says why a reacting case looks the way it does.
    if (summary.damkohler > 0) {
        rows.push([summary.paintedDamkohler !== null ? 'Damkohler, fluid' : 'Damkohler',
            summary.damkohler.toFixed(1), panelRegime(summary.damkohler)]);
    }
    if (summary.paintedDamkohler !== null) {
        rows.push(['Damkohler, catalyst', `${summary.paintedDamkohler.toFixed(1)} at x1`,
            panelRegime(summary.paintedDamkohler)]);
    }
    if (summary.paintedPermeability !== null) {
        const [thinnest, thickest] = summary.paintedScreeningCells;
        rows.push(['permeability, porous', `${summary.paintedPermeability.toExponential(1)} at x1 to `
            + `${(summary.paintedPermeability / 8).toExponential(1)} at x8, wall layer `
            + `${thickest.toFixed(1)} to ${thinnest.toFixed(1)} cells`, ...panelResolved(thickest, 2)]);
    }
    // A margin only where the step law was measured to bound anything; above
    // that, naming the regime is the checkable statement (cases.js).
    if (summary.momentumAdvects) {
        rows.push(summary.stepLawApplies
            ? ['time step', `${summary.stepMargin.toFixed(1)}x margin`,
                ...(summary.stepMargin > 1.5 ? ['stable', 'on'] : ['near the limit', 'off'])]
            : ['time step', 'no measured limit', 'mesh-limited', 'off']);
    }
    return rows;
}

// The Nusselt row: the two walls' time averages, and whether they agree yet.
// They must agree once the box is settled, since the heat in is the heat out.
function panelNusseltRow(nusselt) {
    if (nusselt === null) return ['Nusselt', 'measuring', 'running only'];
    const mean = 0.5 * (nusselt.hot + nusselt.cold);
    const value = `${nusselt.hot.toFixed(1)} hot, ${nusselt.cold.toFixed(1)} cold`
        + (nusselt.seconds < PANEL_HEAT_FLUX_WINDOW ? `, ${nusselt.seconds} s so far` : '');
    if (Math.abs(nusselt.hot - nusselt.cold) > 0.1 * Math.abs(mean)) return ['Nusselt', value, 'settling', 'off'];
    return ['Nusselt', value, mean < 1.1 ? 'conduction only' : 'convecting', 'on'];
}

// The developer's numbers about the case: what the mesh does to the
// coefficients, and the measured peak speed the panel's numbers are taken at.
function panelCaseDetail(preset, summary) {
    const coefficients = preset.coefficients;
    const rows = [];
    if (summary.hasFlow) {
        rows.push(['viscosity', summary.blended
            ? `${displayNumberText(coefficients.viscosity)}, ${displayNumberText(summary.effectiveViscosity)} at peak`
            : displayNumberText(coefficients.viscosity)]);
    }
    if (summary.momentumAdvects) {
        rows.push(['cell Peclet, momentum',
            panelAtPeak(summary.cellPeclet, summary.effectiveCellPeclet, 2, summary.blended)]);
    }
    if (summary.hasSpecies) {
        rows.push(['cell Peclet, species',
            panelAtPeak(summary.speciesPeclet, summary.effectiveSpeciesPeclet, 2, summary.blended)]);
    }
    rows.push(...panelDiffusivityRows(preset, summary));
    if (coefficients.temperatureSensitivity > 0) {
        rows.push(['rate, 20 degrees hotter', `${Math.exp(coefficients.temperatureSensitivity * 20).toFixed(1)}x`]);
    }
    if (coefficients.sideTemperatureSensitivity > 0) {
        rows.push(['rate to D, 20 degrees hotter', `${Math.exp(coefficients.sideTemperatureSensitivity * 20).toFixed(1)}x`]);
    }
    if (coefficients.heatOfReaction > 0) {
        rows.push(['heat of reaction', `${displayNumberText(coefficients.heatOfReaction)} degrees per unit converted`]);
    }
    if (summary.hasSpecies && summary.mixingToConvection > 0 && Number.isFinite(summary.mixingToConvection)) {
        rows.push(['mixing / convection time', summary.mixingToConvection.toFixed(0),
            summary.mixingToConvection > 1 ? 'convection wins' : 'diffusion wins']);
    }
    if (summary.hasFlow) {
        rows.push(['peak speed', summary.peak.toFixed(2), summary.peakMeasured ? 'measured' : 'not yet measured']);
    }
    return rows;
}

// A number with fixed digits, or infinity where a case asked for one.
function panelFixed(value, digits) {
    return Number.isFinite(value) ? value.toFixed(digits) : '∞';
}

// The diffusivity row

// A diffusivity the medium varies has no single value, so the panel reports the
// range it takes: over the layers a profile declares, sampled on the grid the
// profile check uses, and between the coldest and hottest boundary temperature
// where it depends on temperature. A uniform one is the number it always was.
function panelDiffusivityRange(preset, kind) {
    const heat = kind === 'heat';
    const base = heat ? preset.coefficients.thermalDiffusivity : preset.coefficients.massDiffusivity;
    const profile = heat ? preset.coefficients.thermalDiffusivityProfile : preset.coefficients.massDiffusivityProfile;
    let low = 1, high = 1;
    if (profile) {
        const n = 33;
        high = 0;
        for (let b = 0; b < n; b++) {
            for (let a = 0; a < n; a++) high = Math.max(high, profile.at(a / (n - 1), b / (n - 1)));
        }
    }
    const s = heat ? 0 : preset.coefficients.diffusivityTemperatureSensitivity;
    if (s > 0) {
        // Every temperature a boundary or a heater holds, which bracket the
        // field at steady state.
        const temperatures = [preset.inlet.temperature, preset.wall.temperature,
            ...preset.feeds.filter((feed) => feed.field === 'temperature').map((feed) => feed.target)]
            .filter((t) => typeof t === 'number');
        low *= Math.exp(s * (Math.min(...temperatures) - preset.coefficients.referenceTemperature));
        high *= Math.exp(s * (Math.max(...temperatures) - preset.coefficients.referenceTemperature));
    }
    if (low === high) return displayNumberText(base * low);
    return `${displayNumberText(base * low)} to ${displayNumberText(base * high)}`;
}

// The diffusivity row of the case card, or no row at all where the case
// solves nothing that diffuses but momentum.
function panelDiffusivityRows(preset, summary) {
    const heat = summary.hasTemperature ? panelDiffusivityRange(preset, 'heat') : null;
    let text;
    if (preset.system.physics === 'permeation') {
        text = `${panelDiffusivityRange(preset, 'mass')} mass` + (heat ? `, ${heat} heat` : '');
    } else if (preset.system.physics === 'oregonator') {
        text = `${displayNumberText(preset.coefficients.massDiffusivity)}, every species`;
    } else if (preset.system.physics === 'reactionDiffusion') {
        text = `${displayNumberText(preset.coefficients.massDiffusivity)} and `
            + `${displayNumberText(preset.coefficients.speciesBDiffusivity)}, one per species`;
    } else if (preset.system.physics === 'conduction') {
        text = `${panelDiffusivityRange(preset, 'heat')} heat`;
    } else if (summary.hasFlow) {
        const parts = [];
        if (summary.hasSpecies) parts.push(`${displayNumberText(preset.coefficients.massDiffusivity)} mass`);
        if (heat) parts.push(`${heat} heat`);
        if (preset.system.physics === 'mhd') parts.push(`${displayNumberText(preset.coefficients.magneticDiffusivity)} magnetic`);
        if (!parts.length) return [];
        text = parts.join(', ');
    } else {
        return [];
    }
    return [['diffusivity', text]];
}
