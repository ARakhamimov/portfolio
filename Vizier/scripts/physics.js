// physics.js, by Allen Rakhamimov.
// One builder per physics: the equations a case's declaration becomes, its
// boundary table and its starting state.
//
// A case names its physics (system.physics) and physicsBuildSystem calls that
// physics' builder; the terms each builder lists are entries of the term
// dictionary (terms.js). A first read takes physicsSystem, then the builder
// for one case's physics. Everything here reads a preset and writes nothing
// back.

'use strict';

// Shared numbers

// The one exception to CASE_THETA: Schrodinger's equation has no stiff
// decaying mode for Crank-Nicolson to ring on, and theta = 1/2 is what keeps
// the total probability, which 0.55 would lose a little of every step. Set by
// the physics, never by a case.
const PHYSICS_SCHRODINGER_THETA = 0.5;

// hbar / 2m, with hbar = m = 1.
const PHYSICS_SCHRODINGER_DISPERSION = 0.5;

// The equations

// The system a preset runs, carrying its physics, so that whatever presents
// it names things by the system and not by whichever case is running.
function physicsSystem(preset) {
    return { ...physicsBuildSystem(preset), physics: preset.system.physics,
        materials: preset.display.materials, heatFluxWalls: physicsHeatFluxWalls(preset) };
}

// The two edges a Nusselt number is measured on, where the case names them and
// solves the temperature they measure; null otherwise.
function physicsHeatFluxWalls(preset) {
    const walls = preset.panel.heatFluxWalls;
    if (!walls) return null;
    const edges = ['left', 'right', 'top', 'bottom'];
    if (!edges.includes(walls.hot) || !edges.includes(walls.cold) || walls.hot === walls.cold) {
        throw new Error(`${preset.id}: heatFluxWalls names two different edges, not ${walls.hot} and ${walls.cold}`);
    }
    return physicsSolvesTemperature(preset) ? { hot: walls.hot, cold: walls.cold } : null;
}

// One builder per physics value; the switch is the list.
function physicsBuildSystem(preset) {
    switch (preset.system.physics) {
        case 'reactionDiffusion': return physicsPatternSystem(preset);
        case 'oregonator':        return physicsOregonatorSystem(preset);
        case 'flow':              return physicsFlowSystem(preset);
        case 'conduction':        return physicsConductionSystem(preset);
        case 'permeation':        return physicsPermeationSystem(preset);
        case 'electrostatics':    return physicsPotentialSystem(preset);
        case 'magnetostatics':    return physicsPotentialSystem(preset);
        case 'telegraph':         return physicsTelegraphSystem(preset);
        case 'mhd':               return physicsFlowSystem(preset);
        case 'schrodinger':       return physicsSchrodingerSystem(preset);
        default:
            throw new Error(`preset ${preset.id} declares physics "${preset.system.physics}", which `
                + 'physicsSystem does not build. The list is in this switch.');
    }
}

// The heat equation alone.
function physicsConductionSystem(preset) {
    const diffusivity = physicsThermalDiffusivity(preset);
    return normalizeSystem({
        name: preset.id,
        equations: [
            { field: 'temperature', location: CENTER, role: ROLE_SCALAR,
              theta: CASE_THETA, timeStep: preset.solver.timeStep,
              terms: [{ term: 'diffusion', diffusivity: diffusivity },
                      ...physicsFeedTerms(preset, 'temperature')] },
        ],
        relaxation: { scheme: POINTWISE },
    });
}

// One species diffusing through a stationary medium, and the temperature too
// where something can make it differ: the membrane cases.
function physicsPermeationSystem(preset) {
    const unsteady = { location: CENTER, role: ROLE_SCALAR,
        theta: CASE_THETA, timeStep: preset.solver.timeStep };
    const equations = [];
    if (physicsSolvesTemperature(preset)) {
        equations.push({ field: 'temperature', ...unsteady,
            terms: [{ term: 'diffusion', diffusivity: physicsThermalDiffusivity(preset) },
                    ...physicsFeedTerms(preset, 'temperature')] });
    }
    equations.push({ field: 'speciesA', ...unsteady,
        terms: [{ term: 'diffusion', diffusivity: physicsMassDiffusivity(preset) },
                ...physicsFeedTerms(preset, 'speciesA')] });
    return normalizeSystem({ name: preset.id, equations, relaxation: { scheme: POINTWISE } });
}

// Two species and nothing else. With no constraint row the relaxation is
// pointwise.
function physicsPatternSystem(preset) {
    const unsteady = { theta: CASE_THETA, timeStep: preset.solver.timeStep };

    return normalizeSystem({
        name: preset.id,
        equations: [
            { field: 'speciesA', location: CENTER, role: ROLE_SCALAR, ...unsteady,
              terms: physicsPatternTerms(preset, 'speciesA') },
            { field: 'speciesB', location: CENTER, role: ROLE_SCALAR, ...unsteady,
              terms: physicsPatternTerms(preset, 'speciesB') },
        ],
        relaxation: { scheme: POINTWISE },
    });
}

// Electrostatics and magnetostatics without free current are Darcy's pair of
// rows renamed, written the way they are relaxed:
//
//     (1/eps) D + grad phi = 0,      div D = rho
//     (1/mu)  B + grad psi = 0,      div B = 0
//
// so the material is a first order sink on the flux rows and the charge a
// source on the constraint row.
function physicsPotentialSystem(preset) {
    const electric = preset.system.physics === 'electrostatics';
    const material = electric ? preset.coefficients.inversePermittivity : preset.coefficients.inversePermeability;
    if (material === undefined) {
        throw new Error(`${preset.id}: ${preset.system.physics} needs `
            + `${electric ? 'inversePermittivity' : 'inversePermeability'}`);
    }
    const flux = (field, location, component) => ({
        field, location, role: ROLE_VELOCITY, steady: true,
        terms: [{ term: 'firstOrderSink', rate: material },
                { term: 'gradientOf', field: 'potential', component }],
    });
    const constraint = [{ term: 'divergenceOf', xField: 'fluxX', yField: 'fluxY' }];
    if (electric && preset.charges.length > 0) constraint.push(physicsChargeTerm(preset.charges));
    return normalizeSystem({
        name: preset.id,
        equations: [
            flux('fluxX', XFACE, 'x'),
            flux('fluxY', YFACE, 'y'),
            { field: 'potential', location: CENTER, role: ROLE_PRESSURE,
              constraint: true, steady: true, terms: constraint },
        ],
        relaxation: { scheme: SCHUR_RELAXATION, c: 0.5 },
    });
}

// Charges as disks of uniform density, summed into one source.
function physicsChargeTerm(charges) {
    const density = positionProfile(charges.map((charge) => `select(0.0, ${wgslNumber(charge.density)}, `
        + `${profileSquaredDistance(charge.x, charge.y)} < ${wgslNumber(charge.radius ** 2)})`).join(' + '));
    return { term: 'source', value: density.at, wgsl: density.wgsl };
}

// The telegraph equations in first order form, with the wave speed as the unit:
//
//     dJ/dt + gamma J = -grad V,      dV/dt + div J = 0
//
// Both rows are unsteady and neither is a constraint.
function physicsTelegraphSystem(preset) {
    const unsteady = { theta: CASE_THETA, timeStep: preset.solver.timeStep };
    const current = (field, location, component) => ({
        field, location, role: ROLE_VELOCITY, ...unsteady,
        terms: [{ term: 'firstOrderSink', rate: coefficientSlot('damping') },
                { term: 'gradientOf', field: 'potential', component }],
    });
    return normalizeSystem({
        name: preset.id,
        equations: [
            current('fluxX', XFACE, 'x'),
            current('fluxY', YFACE, 'y'),
            { field: 'potential', location: CENTER, role: ROLE_SCALAR, ...unsteady,
              terms: [{ term: 'divergenceOf', xField: 'fluxX', yField: 'fluxY' }] },
        ],
        relaxation: { scheme: POINTWISE },
    });
}

// Schrodinger's equation for psi = psi_R + i psi_I, in units where hbar = m = 1:
//
//     dpsi_R/dt = -(1/2) lap psi_I + V psi_I
//     dpsi_I/dt =  (1/2) lap psi_R - V psi_R
//
// with the potential energy V = V0 w(x, y), a height a slider moves times a
// shape the case declares.
// Each row's own value appears only in its time derivative, so the coupling is
// lagged between the two rows, and that limits the step to about h^2 / 2
// whatever theta is.
function physicsSchrodingerSystem(preset) {
    const unsteady = { location: CENTER, role: ROLE_SCALAR,
        theta: PHYSICS_SCHRODINGER_THETA, timeStep: preset.solver.timeStep };
    const shape = preset.coefficients.potentialShape;
    const part = (field, partner, kineticSign) => {
        const terms = [{ term: 'laplacianOf', field: partner, coefficient: PHYSICS_SCHRODINGER_DISPERSION,
            sign: kineticSign }];
        if (shape) {
            terms.push({ term: 'proportionalSource', field: partner,
                coefficient: coefficientSlot('potentialHeight'), weight: shape,
                sign: kineticSign === '-' ? '+' : '-' });
        }
        return { field, ...unsteady, terms };
    };
    return normalizeSystem({
        name: preset.id,
        equations: [part('waveReal', 'waveImaginary', '-'), part('waveImaginary', 'waveReal', '+')],
        relaxation: { scheme: POINTWISE },
    });
}

// Gaussian packets exp(-r^2 / (2 width^2)) exp(i k.x), summed, since a wave
// function is a superposition, as the two patches that seed its real and
// imaginary parts.
function physicsWavePackets(packets) {
    const part = (take) => (px, py) => packets.reduce((sum, { x, y, width, kx, ky }) => {
        const envelope = Math.exp(-((px - x) ** 2 + (py - y) ** 2) / (2 * width * width));
        return sum + envelope * take(kx * (px - x) + ky * (py - y));
    }, 0);
    return [
        { field: 'waveReal', value: part(Math.cos) },
        { field: 'waveImaginary', value: part(Math.sin) },
    ];
}

// The Oregonator, Field and Noyes's model of the Belousov-Zhabotinsky reaction
// in the unscaled three-variable form of Field's review (Scholarpedia 2(5):1386,
// 2007, Eqs 1-3). Five mass action steps, X = HBrO2 (species A),
// Y = Br- (species B) and Z = Ce(IV) (species C):
//
//     a:  Y -> X             k_a = k1 [BrO3-]
//     b:  X + Y -> P         k_b = k2
//     c:  X -> 2X + 2Z       k_c = k3 [BrO3-]      autocatalytic
//     d:  2X -> P            k_d = k4
//     e:  Z -> (f/2) Y       k_e = kc [organic]
//
// Concentrations in mM: k_a 0.0768 and k_c 2.016 per second, k_b 2400 and k_d
// 2.4 per mM per second. k_e and f are slots a viewer moves.
const PHYSICS_OREGONATOR = { stepA: 0.0768, stepB: 2400, stepC: 2.016, stepD: 2.4 };

function physicsOregonatorTerms(preset, field) {
    const { stepA, stepB, stepC, stepD } = PHYSICS_OREGONATOR;
    if (!(preset.coefficients.recoveryRate > 0 && preset.coefficients.stoichiometricFactor > 0)) {
        throw new Error(`${preset.id}: an Oregonator needs a positive recoveryRate and `
            + 'stoichiometricFactor');
    }
    const diffusion = { term: 'diffusion', diffusivity: coefficientSlot('massDiffusivity') };
    switch (field) {
        case 'speciesA': return [
            diffusion,
            { term: 'reactionSource', rate: stepA, reactants: ['speciesB'], reaction: 'a' },
            { term: 'reactionSink', rate: stepB, partners: ['speciesB'], reaction: 'b' },
            { term: 'reactionSource', rate: stepC, reactants: ['speciesA'], reaction: 'c' },
            { term: 'secondOrderSink', rate: 2 * stepD, reaction: 'd' },
        ];
        case 'speciesB': return [
            diffusion,
            { term: 'firstOrderSink', rate: stepA, reaction: 'a' },
            { term: 'reactionSink', rate: stepB, partners: ['speciesA'], reaction: 'b' },
            { term: 'reactionSource', rate: coefficientSlot('bromideReturnRate'),
              reactants: ['speciesC'], reaction: 'e' },
        ];
        case 'speciesC': return [
            diffusion,
            { term: 'reactionSource', rate: 2 * stepC, reactants: ['speciesA'], reaction: 'c' },
            { term: 'firstOrderSink', rate: coefficientSlot('recoveryRate'), reaction: 'e' },
        ];
        default: throw new Error(`the Oregonator has no species ${field}`);
    }
}

function physicsOregonatorSystem(preset) {
    const unsteady = { theta: CASE_THETA, timeStep: preset.solver.timeStep };
    return normalizeSystem({
        name: preset.id,
        equations: ['speciesA', 'speciesB', 'speciesC'].map((field) => ({
            field, location: CENTER, role: ROLE_SCALAR, ...unsteady,
            terms: physicsOregonatorTerms(preset, field),
        })),
        relaxation: { scheme: POINTWISE },
    });
}

// Momentum, the constraint, and whatever scalars can move.
// `options.solveTemperature` overrides the rule, for the check that holds the
// rule against the equations it would drop.
function physicsFlowSystem(preset, options = {}) {
    const solveTemperature = options.solveTemperature !== undefined
        ? options.solveTemperature : physicsSolvesTemperature(preset);
    const unsteady = { theta: CASE_THETA, timeStep: preset.solver.timeStep };
    if (physicsHasSideReaction(preset) && preset.system.kinetics !== 'massAction') {
        throw new Error(`preset ${preset.id} declares a side reaction with kinetics `
            + `${preset.system.kinetics}; the side reaction is mass action, and pairing it with a `
            + 'saturating main reaction would give the case two rate laws under one label');
    }

    return normalizeSystem({
        name: preset.id,
        equations: [
            { field: 'xVelocity', location: XFACE, role: ROLE_VELOCITY, ...unsteady,
              terms: physicsMomentumTerms(preset, 'x') },
            { field: 'yVelocity', location: YFACE, role: ROLE_VELOCITY, ...unsteady,
              terms: physicsMomentumTerms(preset, 'y') },
            { field: 'pressure', location: CENTER, role: ROLE_PRESSURE,
              constraint: true, steady: true,
              terms: [{ term: 'divergenceOf', xField: 'xVelocity', yField: 'yVelocity' }] },
            ...(solveTemperature ? [
                { field: 'temperature', location: CENTER, role: ROLE_SCALAR, ...unsteady,
                  terms: physicsTemperatureTerms(preset) },
            ] : []),
            ...(preset.system.transportsSpecies ? [
                { field: 'speciesA', location: CENTER, role: ROLE_SCALAR, ...unsteady,
                  terms: physicsSpeciesTerms(preset, 'speciesA') },
                { field: 'speciesB', location: CENTER, role: ROLE_SCALAR, ...unsteady,
                  terms: physicsSpeciesTerms(preset, 'speciesB') },
            ] : []),
            // Species C only where something can put it there, and D only where
            // the side reaction makes it.
            ...(preset.system.transportsSpecies && physicsHasSpeciesC(preset) ? [
                { field: 'speciesC', location: CENTER, role: ROLE_SCALAR, ...unsteady,
                  terms: physicsSpeciesTerms(preset, 'speciesC') },
            ] : []),
            ...(physicsHasSideReaction(preset) ? [
                { field: 'speciesD', location: CENTER, role: ROLE_SCALAR, ...unsteady,
                  terms: physicsSpeciesTerms(preset, 'speciesD') },
            ] : []),
            ...(preset.system.physics === 'mhd' ? [
                { field: 'potential', location: CENTER, role: ROLE_SCALAR, ...unsteady,
                  terms: physicsInductionTerms(preset) },
            ] : []),
        ],
        relaxation: { scheme: SCHUR_RELAXATION, c: preset.solver.constraintStep },
    });
}

// The momentum row. Open fluid carries shear and inertia; a porous bed carries
// Darcy's drag, and Brinkman's shear beside it lets a no-slip wall reach into
// the bed. Seepage is creeping flow, so the porous row has no advection.
function physicsMomentumTerms(preset, component) {
    const gradient = { term: 'gradientOf', field: 'pressure', component };

    if (physicsIsPorous(preset)) {
        const terms = [];
        if (preset.system.porous === 'brinkman') {
            terms.push({ term: 'diffusion', diffusivity: coefficientSlot('viscosity') });
        }
        terms.push({ term: 'firstOrderSink', rate: physicsDrag(preset) });
        return [...terms, gradient];
    }

    // Zero viscosity asks for the Euler equations: the diffusion term is left
    // out, and the blend, still reading the zero, runs pure upwind.
    return [
        ...(preset.coefficients.viscosity > 0
            ? [{ term: 'diffusion', diffusivity: coefficientSlot('viscosity') }] : []),
        physicsAdvection(coefficientSlot('viscosity')),
        gradient,
        ...(component === 'y' ? physicsBuoyancyTerms(preset) : []),
        ...physicsLorentzTerms(preset, component),
        ...(preset.paintable ? [physicsPaintedDrag(component)] : []),
    ];
}

function physicsIsPorous(preset) {
    return preset.system.porous !== undefined;
}

// Darcy's drag, and in a fouled bed the drag times a shape that is higher
// inside the plugged patch.
function physicsDrag(preset) {
    if (!preset.coefficients.fouledPatch) return coefficientSlot('drag');
    return coefficientProfile('drag',
        profilePatchFactor(preset.coefficients.fouledPatch.factor, preset.coefficients.fouledPatch.rect));
}

// Where the sandbox's porous medium is painted, Darcy's drag on one
// component's faces.
function physicsPaintedDrag(component) {
    return { term: 'firstOrderSink',
        rate: coefficientPainted(component === 'x' ? 'paintPorousXFace' : 'paintPorousYFace',
            0, coefficientSlot('paintedDrag')) };
}

// A density difference's force on the y velocity. y runs down the screen, so a
// hot parcel's force carries a minus sign and a heavy one's a plus.
function physicsBuoyancyTerms(preset) {
    if (!(preset.coefficients.buoyancy > 0)) return [];
    const spec = preset.system.buoyantField;
    if (!spec || !spec.field || (spec.sign !== '+' && spec.sign !== '-')) {
        throw new Error(`${preset.id}: buoyancy needs system.buoyantField { field, reference, sign }`);
    }
    return [{ term: 'proportionalSource', field: spec.field, coefficient: coefficientSlot('buoyancy'),
        reference: spec.reference || 0, sign: spec.sign }];
}

// A conducting fluid in 2D, through the magnetic vector potential A = A0 + a,
// the applied uniform field plus the induced part the system solves:
//
//     da/dt + u . grad a = eta lap a - u . grad A0 + (applied E, where it is)
//     du/dt + ...        = ... - (lap A) grad A
//
// B = (dA/dy, -dA/dx) has no divergence whatever A is, so no constraint row is
// needed. B is in Alfven units.
function physicsLorentzTerms(preset, component) {
    if (preset.system.physics !== 'mhd') return [];
    return [{ term: 'lorentzForce', field: 'potential', component,
        applied: coefficientSlot('appliedField'), along: physicsFieldDirection(preset) }];
}

function physicsFieldDirection(preset) {
    const along = preset.system.magneticFieldAlong;
    if (along !== 'x' && along !== 'y') {
        throw new Error(`${preset.id}: physics mhd needs system.magneticFieldAlong 'x' or 'y'`);
    }
    return along;
}

function physicsInductionTerms(preset) {
    const eta = preset.coefficients.magneticDiffusivity;
    if (!(eta > 0)) throw new Error(`${preset.id}: physics mhd needs a positive magneticDiffusivity`);
    const along = physicsFieldDirection(preset);
    // -u . grad A0: along x, grad A0 = (0, B0) and the source is -B0 v; along
    // y, grad A0 = (-B0, 0) and it is +B0 u.
    const source = along === 'x'
        ? { field: 'yVelocity', sign: '-' } : { field: 'xVelocity', sign: '+' };
    return [
        { term: 'diffusion', diffusivity: eta },
        physicsAdvection(eta),
        { term: 'proportionalSource', ...source, coefficient: coefficientSlot('appliedField'),
          reference: 0 },
        // An applied electric field E0 out of the plane, a uniform source
        // where it is applied: E = -dA/dt + E0 there.
        ...(preset.coefficients.appliedElectricField > 0 ? [
            { term: 'source', value: coefficientSlot('appliedElectricField'),
              sign: preset.system.electricFieldSign, ...(preset.system.electricFieldRegion || {}) },
        ] : []),
    ];
}

// Transport, any heated section, and the exotherm.
function physicsTemperatureTerms(preset) {
    // A slot only where the case offers its slider. Advection reads the same
    // value, so the blend follows the slider.
    const diffusivity = caseSliderValue(preset, 'thermalDiffusivity');
    const terms = [
        { term: 'diffusion', diffusivity: diffusivity },
        physicsAdvection(diffusivity),
        ...physicsFeedTerms(preset, 'temperature'),
    ];

    if (!(preset.coefficients.heatOfReaction > 0) && !(preset.coefficients.sideHeatOfReaction > 0)) return terms;
    if (preset.system.kinetics !== 'massAction') {
        throw new Error(`preset ${preset.id} declares heatOfReaction with kinetics `
            + `${preset.system.kinetics}. This heat term is the mass-action rate, so a saturating law `
            + 'wants its own, built from the same entry that law uses on the product.');
    }

    // heatReleaseRate is the rate constant times the heat per unit converted,
    // multiplied on the host: a slot holds a number a term reads directly.
    const heat = [];
    if (preset.coefficients.heatOfReaction > 0) {
        heat.push({ term: 'reactionSource', rate: physicsRate(preset, 'heatReleaseRate'),
            reactants: ['speciesA', 'speciesB'], reaction: 'main' });
    }
    if (preset.coefficients.sideHeatOfReaction > 0 && physicsHasSideReaction(preset)) {
        heat.push({ term: 'reactionSource',
            rate: physicsRate(preset, 'sideHeatReleaseRate', 'sideTemperatureSensitivity'),
            reactants: ['speciesA', 'speciesB'], reaction: 'side' });
    }
    return [...terms, ...heat];
}

// Transport, any interior feeds, and the rate law. Every reaction term carries
// `reaction`, which nothing that computes reads: the panel gathers a
// reaction's terms by it and writes the reaction's formula from them.
function physicsSpeciesTerms(preset, field) {
    const terms = [
        ...(preset.coefficients.massDiffusivity > 0
            ? [{ term: 'diffusion', diffusivity: coefficientSlot('massDiffusivity') }] : []),
        physicsAdvection(coefficientSlot('massDiffusivity')),
        ...physicsFeedTerms(preset, field),
    ];

    // Whether there is a reaction is the preset's to say; a slider changes only
    // how fast it runs.
    if (preset.coefficients.reactionRate === 0) return terms;

    const rate = physicsRate(preset, 'reactionRate');
    const halfSaturation = coefficientSlot('halfSaturation');
    const saturating = preset.system.kinetics === 'michaelisMenten' || preset.system.kinetics === 'monod';

    if (saturating && !(preset.coefficients.halfSaturation > 0)) {
        throw new Error(`preset ${preset.id} declares ${preset.system.kinetics} with no positive `
            + 'halfSaturation. Without one the rate law is not saturating and the denominator '
            + 'it builds is undefined at zero concentration.');
    }
    if (preset.system.kinetics === 'monod' && !(preset.coefficients.yieldCoefficient > 0)) {
        throw new Error(`preset ${preset.id} declares monod with no positive yieldCoefficient. `
            + 'It sets how much substrate a unit of biomass costs and divides the sink rate.');
    }

    switch (preset.system.kinetics) {

        // v = k [E] [S] / (Km + [S]), with B the enzyme: it multiplies the
        // rate and is never consumed.
        case 'michaelisMenten':
            if (field === 'speciesA') {
                return [...terms, { term: 'saturatingSink', rate, halfSaturation,
                    partner: 'speciesB', reaction: 'main' }];
            }
            if (field === 'speciesC') {
                return [...terms, { term: 'saturatingSource', rate, halfSaturation,
                    substrate: 'speciesA', partner: 'speciesB', reaction: 'main' }];
            }
            return terms;   // the catalyst is conserved

        // v = mu [S] X / (Ks + [S]), with B the biomass X. The source lands on
        // the field it multiplies, which makes growth autocatalytic; the
        // substrate falls at that rate over the yield, and nothing writes C.
        case 'monod':
            if (field === 'speciesA') {
                // Its own slot, the growth rate over the yield, divided on the
                // host (appCoefficientValues).
                return [...terms, { term: 'saturatingSink',
                    rate: physicsRate(preset, 'uptakeRate'), halfSaturation,
                    partner: 'speciesB', reaction: 'main' }];
            }
            if (field === 'speciesB') {
                return [...terms, { term: 'saturatingSource', rate, halfSaturation,
                    substrate: 'speciesA', partner: 'speciesB', reaction: 'main' }];
            }
            return terms;

        // A + B -> C, and where the case declares one, the side reaction
        // A + B -> D at its own rate: the feeds lose to both.
        default: {
            const side = physicsHasSideReaction(preset)
                ? physicsRate(preset, 'sideReactionRate', 'sideTemperatureSensitivity') : null;
            if (field === 'speciesC') {
                return [...terms, { term: 'reactionSource', rate,
                    reactants: ['speciesA', 'speciesB'], reaction: 'main' }];
            }
            if (field === 'speciesD') {
                return [...terms, { term: 'reactionSource', rate: side,
                    reactants: ['speciesA', 'speciesB'], reaction: 'side' }];
            }
            const partners = [field === 'speciesA' ? 'speciesB' : 'speciesA'];
            return [...terms, { term: 'reactionSink', rate, partners, reaction: 'main' },
                ...(side ? [{ term: 'reactionSink', rate: side, partners, reaction: 'side' }] : [])];
        }
    }
}

// Gray and Scott's U + 2V -> 3V, with U fed at F and V removed at F + k:
//
//     dU/dt = D_U lap U - k U V^2 + F (1 - U)
//     dV/dt = D_V lap V + k U V^2 - (F + k) V
function physicsPatternTerms(preset, field) {
    const catalyst = new Array(preset.system.speciesBOrder).fill('speciesB');
    const rate = physicsRate(preset, 'reactionRate');

    if (field === 'speciesA') {
        return [
            { term: 'diffusion', diffusivity: coefficientSlot('massDiffusivity') },
            { term: 'reactionSink', rate, partners: catalyst, reaction: 'main' },
            { term: 'regionSource', rate: coefficientSlot('feedRate'), target: 1 },
        ];
    }
    return [
        { term: 'diffusion', diffusivity: coefficientSlot('speciesBDiffusivity') },
        { term: 'reactionSource', rate, reactants: ['speciesA', ...catalyst], reaction: 'main' },
        { term: 'firstOrderSink', rate: coefficientSlot('removalRate'), reaction: 'removal' },
    ];
}

// Any interior feeds the preset declares for one field. One entry serves a
// species patch, a heated section, and with no region a feed everywhere.
function physicsFeedTerms(preset, field) {
    return (preset.feeds || [])
        .filter((feed) => feed.field === field)
        .map((feed) => ({ term: 'regionSource', rate: feed.rate, target: feed.target,
            at: feed.at, wgsl: feed.wgsl }));
}

// Every advection term in every case is built here and bounded the same way,
// with the advected field's own diffusivity. Pass a slot wherever a slider
// moves the coefficient, so the blend follows it.
function physicsAdvection(diffusivity) {
    return {
        term: 'advection', xField: 'xVelocity', yField: 'yVelocity',
        boundedness: 'hybrid', diffusivity,
    };
}

// A rate, temperature-dependent for the whole of one reaction or for none of
// it: each reaction declares its sensitivity once, and it reaches every term
// that reaction puts in the system.
function physicsRate(preset, slotName, sensitivityName = 'temperatureSensitivity') {
    const slot = physicsPaintedRate(preset, slotName);
    if (!(preset.coefficients[sensitivityName] > 0)) return slot;
    return arrheniusRate({
        rate: slot,
        sensitivity: coefficientSlot(sensitivityName),
        reference: preset.coefficients.referenceTemperature,
    });
}

// On the sandbox's painted catalyst a rate is its painted twin times the
// strength painted there. A paintable case with any other rate is refused.
const PHYSICS_PAINTED_RATES = { reactionRate: 'paintedReactionRate', uptakeRate: 'paintedUptakeRate' };

function physicsPaintedRate(preset, slotName) {
    const slot = coefficientSlot(slotName);
    if (!preset.paintable) return slot;
    const painted = PHYSICS_PAINTED_RATES[slotName];
    if (!painted) throw new Error(`${preset.id} is paintable and declares ${slotName}, which has no painted twin`);
    return coefficientPainted('paintCatalystCenter', slot, coefficientSlot(painted));
}

// A diffusivity inside a flux: the declared value, or its slot, times a profile
// where the medium is layered, and in D(T) form where the case declares one.
// The dictionary reads it on faces, so only rows at cell centers may take it.
function physicsThermalDiffusivity(preset) {
    return physicsLayered(caseSliderValue(preset, 'thermalDiffusivity'),
        preset.coefficients.thermalDiffusivityProfile);
}

function physicsMassDiffusivity(preset) {
    const layered = physicsLayered(coefficientSlot('massDiffusivity'),
        preset.coefficients.massDiffusivityProfile);
    if (!(preset.coefficients.diffusivityTemperatureSensitivity > 0)) return layered;
    return arrheniusRate({
        rate: layered,
        sensitivity: preset.coefficients.diffusivityTemperatureSensitivity,
        reference: preset.coefficients.referenceTemperature,
    });
}

function physicsLayered(base, profile) {
    if (!profile) return base;
    return coefficientProfile(coefficientIsSlot(base) ? base.coefficientSlot : base, profile);
}

// What a case solves
//
// One predicate each, read by the builders and by the panel, so the two cannot
// disagree.

// Whether anything can make species C: a reaction, on open fluid or on painted
// catalyst, a feed of it at an inlet, or a starting patch of it. Choosing a
// reaction is a rebuild, so a case that turns one on gains the row then.
function physicsHasSpeciesC(preset) {
    const fed = preset.inlet.species && preset.inlet.species.speciesC !== undefined
        && preset.inlet.species.speciesC !== 0;
    return preset.coefficients.reactionRate > 0 || preset.coefficients.paintedReactionRate > 0
        || fed || (preset.initial.patches || []).some((patch) => patch.field === 'speciesC');
}

function physicsHasSideReaction(preset) {
    return preset.coefficients.sideReactionRate > 0;
}

function physicsHasFlow(preset) {
    return preset.system.physics === 'flow' || preset.system.physics === 'mhd';
}

// A flow case solves temperature only where something can make it differ from
// where it starts.
function physicsSolvesTemperature(preset) {
    const start = preset.initial.temperature !== undefined
        ? preset.initial.temperature : preset.inlet.temperature;
    const differs = (value) => value !== undefined && value !== start;
    return differs(preset.inlet.temperature)
        || differs(preset.wall.temperature)
        || preset.feeds.some((feed) => feed.field === 'temperature')
        || preset.coefficients.heatOfReaction > 0 || preset.coefficients.sideHeatOfReaction > 0
        || preset.coefficients.temperatureSensitivity > 0 || preset.coefficients.sideTemperatureSensitivity > 0
        || preset.coefficients.diffusivityTemperatureSensitivity > 0
        || COEFFICIENT_SLIDERS.some((constant) => constant.literal && caseHasSlider(preset, constant.name))
        || (preset.coefficients.buoyancy > 0 && !!preset.system.buoyantField
            && preset.system.buoyantField.field === 'temperature');
}

// The boundary table

// Type is per location, from the solid mask; kind and value are per (type,
// field).
function physicsBoundaryTable(preset) {
    const table = defaultBoundaryTable();
    const both = (kind, value) => ({ surface: { kind, value }, tangential: { kind, value } });

    const inlet = {
        xVelocity: both(DIRICHLET, preset.inlet.velocityX || preset.inlet.speed),
        yVelocity: both(DIRICHLET, preset.inlet.velocityY || 0),
        temperature: both(DIRICHLET, caseSliderValue(preset, 'inletTemperature')),
    };
    for (const [name, value] of Object.entries(preset.inlet.species || {})) {
        inlet[name] = both(DIRICHLET, value);
    }
    // A case that declares a ports list, even an empty one, feeds every
    // inlet from its ports, so the shader is the same for every layout.
    if (Array.isArray(preset.geometry.ports)) {
        for (const name of ['xVelocity', 'yVelocity', 'speciesA', 'speciesB']) {
            inlet[name] = both(DIRICHLET, boundaryPortValue(name));
        }
    }
    table[INLET].fields = inlet;

    // A flux entering normal to an inlet edge, as a uniform field does.
    if (preset.inlet.flux !== undefined) {
        inlet.fluxX = both(DIRICHLET, preset.inlet.flux);
        inlet.fluxY = both(DIRICHLET, 0);
    }
    // A telegraph line's grounded edges hold the voltage at zero.
    if (preset.system.physics === 'telegraph') {
        table[OUTLET].fields = { potential: both(DIRICHLET, 0) };
    }

    if (preset.wall.temperature !== undefined) {
        table[WALL].fields = {
            temperature: both(DIRICHLET, caseSliderValue(preset, 'wallTemperature')),
        };
    }
    for (const [name, value] of Object.entries(preset.wall.species || {})) {
        table[WALL].fields = { ...table[WALL].fields, [name]: both(DIRICHLET, value) };
    }
    // A conducting fluid's induced potential is zero at inlets and on every
    // solid, which holds the field's normal component at the applied value
    // there; the outlet leaves it free.
    // A wave function is zero on every solid: an infinitely high wall.
    if (preset.system.physics === 'schrodinger') {
        table[WALL].fields = { waveReal: both(DIRICHLET, 0), waveImaginary: both(DIRICHLET, 0) };
    }
    if (preset.system.physics === 'mhd') {
        inlet.potential = both(DIRICHLET, 0);
        table[WALL].fields = { ...table[WALL].fields, potential: both(DIRICHLET, 0) };
    }
    return table;
}

// The starting state

// What the interior holds before the first step. A field the system does not
// solve is skipped, since an array nothing advances would show a picture that
// looks like a result.
function physicsInitialValues(preset, system) {
    const solved = new Set(system.equations.map((equation) => equation.field));
    const values = [];
    if (solved.has('temperature')) {
        const start = preset.initial.temperature !== undefined
            ? preset.initial.temperature : preset.inlet.temperature;
        if (!Number.isFinite(start)) {
            throw new Error(`${preset.id}: the feed temperature is a profile, so the case has to `
                + 'declare initial.temperature, the one value the interior starts at');
        }
        values.push({ field: 'temperature', value: start });
    }
    const patches = [...(preset.initial.packets.length ? physicsWavePackets(preset.initial.packets) : []),
        ...(preset.initial.patches || [])];
    for (const entry of patches) {
        if (solved.has(entry.field)) values.push(entry);
    }
    return values;
}

// The interior only: the frame fills the ghost points on the GPU before it
// steps or draws (CycleRunner.frame).
function physicsSeed(plate, system, preset) {
    const interiorCells = plate.interior[0];
    const spacing = plate.spacing[0];

    // Cell centers only: every field a case seeds is a concentration, a
    // temperature or a potential.
    for (const entry of physicsInitialValues(preset, system)) {
        const array = plate[entry.field];
        const history = plate[`${entry.field}Old`];
        for (let row = 1; row <= interiorCells; row++) {
            for (let column = 1; column <= interiorCells; column++) {
                // A patch's region is a mask, and its value may be a function
                // of position, for a start that has to be smooth.
                const x = (column - 0.5) * spacing, y = (row - 0.5) * spacing;
                if (entry.at && !entry.at(x, y)) continue;
                const value = typeof entry.value === 'function' ? entry.value(x, y) : entry.value;
                const p = plate.indexCenter(0, column, row);
                array[p] = value;
                if (history) history[p] = value;
            }
        }
    }
}
