// coefficients.js, by Allen Rakhamimov.
// The constants a case declares, the slots a term reads them through, and the
// four forms a coefficient takes: a number, a slot a slider moves, a profile
// in space, or a painted region.
//
// Each form is resolved the same way in both languages, coefficientValueOf in
// JavaScript and coefficientCodeOf in WGSL, so the panel and the shader read
// one coefficient.

'use strict';

// The declared constants and the slots
//
// A case declares physical constants (its coefficients group, and the two
// boundary temperatures in their own groups). A slot holds what a term reads
// directly, in the Coefficients buffer, so moving a slider is a buffer write
// and not a rebuild; a slot built from two constants is built on the host.
// Both tables are read by everything that needs them: the case defaults, the
// slider bar, which slots a slider feeds, the Coefficients struct, the values
// written into it, and the symbols the panel sets.

// Every constant a case may declare, with the value it takes when the case is
// silent. One a viewer may move has a slider label, in the order the bar shows
// them; it moves in equal ratios, or linearly where it says so. A LITERAL is
// written into the shader unless the case gives it a slider, and then read
// from the slot of its own name. A PATH says where a constant lives outside the
// coefficients group.
const COEFFICIENT_CONSTANTS = [
    { name: 'viscosity',            default: undefined, slider: 'viscosity' },     // every case states its own
    { name: 'permeability',         default: undefined, slider: 'permeability' },  // of a porous bed
    { name: 'massDiffusivity',      default: 0.01, slider: 'mass diffusivity' },
    { name: 'speciesBDiffusivity',  default: 0, slider: 'diffusivity of B' },      // a pattern case's B
    { name: 'reactionRate',         default: 0, slider: 'rate constant' },
    { name: 'paintedReactionRate',  default: 0, slider: 'rate constant, on catalyst' },  // on the sandbox's painted catalyst
    { name: 'porousPermeability',   default: undefined, slider: 'permeability, porous' },   // of the sandbox's painted porous medium
    { name: 'feedRate',             default: 0, slider: 'feed rate' },             // Gray-Scott's F
    { name: 'killRate',             default: 0, slider: 'removal rate' },          // Gray-Scott's k
    { name: 'recoveryRate',         default: 0, slider: 'recovery rate' },         // the Oregonator's k_e
    { name: 'stoichiometricFactor', default: 0, slider: 'stoichiometric factor' }, // the Oregonator's f
    { name: 'halfSaturation',       default: 0, slider: 'half saturation' },
    { name: 'yieldCoefficient',     default: 0, slider: 'yield' },
    { name: 'temperatureSensitivity', default: 0, slider: 'temperature sensitivity' },  // s in k(T) = k0 exp(s (T - T0))
    { name: 'heatOfReaction',       default: 0, slider: 'heat of reaction' },      // degrees per unit of feed converted
    { name: 'sideReactionRate',     default: 0, slider: 'rate constant, to D' },   // a positive one adds species D
    { name: 'sideTemperatureSensitivity', default: 0, slider: 'temperature sensitivity, to D' },
    { name: 'sideHeatOfReaction',   default: 0, slider: 'heat of reaction, to D' },
    { name: 'buoyancy',             default: 0, slider: 'buoyancy' },              // g times an expansion coefficient
    { name: 'damping',              default: 0, slider: 'damping' },               // the telegraph line's gamma
    { name: 'potentialHeight',      default: 0, slider: 'potential height' },      // V0 in V = V0 w(x, y), on a wave function
    { name: 'appliedField',         default: 0, slider: 'field strength' },        // B0, in Alfven units
    { name: 'appliedElectricField', default: 0, slider: 'electric field' },        // E0
    { name: 'thermalDiffusivity',   default: 0.01, slider: 'thermal diffusivity', literal: true },
    { name: 'inletTemperature',     path: ['inlet', 'temperature'], slider: 'feed temperature',
        moves: 'linearly', literal: true },
    { name: 'wallTemperature',      path: ['wall', 'temperature'], slider: 'wall temperature',
        moves: 'linearly', literal: true },
    { name: 'heaterTemperature',    default: undefined, slider: 'heater temperature',
        moves: 'linearly', literal: true },                                       // a heated section's target
    // T0, filled from the feed temperature when the presets are read and never
    // moved by a slider (casePresets).
    { name: 'referenceTemperature', default: undefined },
    { name: 'fouledPatch',          default: undefined },   // { factor, rect } where the bed is plugged
    { name: 'thermalDiffusivityProfile', default: undefined },   // a shape of at least one
    { name: 'massDiffusivityProfile', default: undefined },
    { name: 'diffusivityTemperatureSensitivity', default: 0 },  // s in D(T), the same form
    { name: 'magneticDiffusivity',  default: undefined },
    { name: 'inversePermittivity',  default: undefined },   // 1/eps, a number or a profile
    { name: 'inversePermeability',  default: undefined },   // 1/mu
    { name: 'potentialShape',       default: undefined },   // w(x, y), a profile
];

// The constants a viewer may move, in the order the bar shows them.
const COEFFICIENT_SLIDERS = COEFFICIENT_CONSTANTS.filter((constant) => constant.slider);

function coefficientConstant(name) {
    const constant = COEFFICIENT_CONSTANTS.find((entry) => entry.name === name);
    if (!constant) throw new Error(`no declared constant named ${name}; the list is in coefficients.js`);
    return constant;
}

// A constant read straight into the slot of its own name, zero when unset.
function coefficientOwnSlot(name, symbol) {
    return { slot: name, from: [name], value: (c) => c[name] || 0, symbol };
}

// Every slot, in the Coefficients struct's order: the constants it is built
// from, how, and the symbol the panel writes it as. A slot holding a host
// quotient is written as the quotient and bracketed, since it is about to
// stand beside a field and (F + k_rem) C_B is not F + k_rem C_B.
const COEFFICIENT_SLOT_TABLE = [
    { slot: 'viscosity', from: ['viscosity'], value: (c) => c.viscosity, symbol: 'ν' },
    { slot: 'massDiffusivity', from: ['massDiffusivity'], value: (c) => c.massDiffusivity, symbol: 'D' },
    coefficientOwnSlot('reactionRate', 'k'),
    // Monod: growth rate over yield.
    { slot: 'uptakeRate', from: ['reactionRate', 'yieldCoefficient'], symbol: '(μ/Y)',
        value: (c) => ((c.yieldCoefficient || 0) > 0 ? (c.reactionRate || 0) / c.yieldCoefficient : 0) },
    coefficientOwnSlot('halfSaturation', 'K'),
    coefficientOwnSlot('temperatureSensitivity', 's'),
    // The rate times the adiabatic temperature rise; written k_q, a rate that
    // may carry a temperature argument like any other.
    { slot: 'heatReleaseRate', from: ['reactionRate', 'heatOfReaction'], symbol: 'k_q',
        value: (c) => (c.reactionRate || 0) * (c.heatOfReaction || 0) },
    coefficientOwnSlot('sideReactionRate', 'k_D'),
    coefficientOwnSlot('sideTemperatureSensitivity', 's_D'),
    { slot: 'sideHeatReleaseRate', from: ['sideReactionRate', 'sideHeatOfReaction'], symbol: 'k_qD',
        value: (c) => (c.sideReactionRate || 0) * (c.sideHeatOfReaction || 0) },
    // Darcy's drag, the viscosity over the permeability.
    { slot: 'drag', from: ['viscosity', 'permeability'], symbol: '(ν/κ)',
        value: (c) => (c.permeability > 0 ? c.viscosity / c.permeability : 0) },
    // These three are multiplied by the strength a region was painted with. In
    // an equation a painted coefficient is written by its bare symbol with
    // (x, y), as k(x, y), or by these where the bare value is zero, as the drag
    // is; the slider rows and the panel's notes name these.
    coefficientOwnSlot('paintedReactionRate', 'k_cat'),
    { slot: 'paintedUptakeRate', from: ['paintedReactionRate', 'yieldCoefficient'], symbol: '(μ_cat/Y)',
        value: (c) => ((c.yieldCoefficient || 0) > 0 ? (c.paintedReactionRate || 0) / c.yieldCoefficient : 0) },
    { slot: 'paintedDrag', from: ['viscosity', 'porousPermeability'], symbol: '(ν/κ)',
        value: (c) => (c.porousPermeability > 0 ? c.viscosity / c.porousPermeability : 0) },
    // A pattern case's B; its A takes massDiffusivity.
    coefficientOwnSlot('speciesBDiffusivity', 'D_B'),
    coefficientOwnSlot('feedRate', 'F'),
    // What leaves Gray-Scott's V: the feed carries some out, and the kill
    // takes the rest.
    { slot: 'removalRate', from: ['feedRate', 'killRate'], symbol: '(F + k_rem)',
        value: (c) => (c.feedRate || 0) + (c.killRate || 0) },
    coefficientOwnSlot('recoveryRate', 'k_e'),
    { slot: 'bromideReturnRate', from: ['stoichiometricFactor', 'recoveryRate'], symbol: '(f k_e/2)',
        value: (c) => 0.5 * (c.stoichiometricFactor || 0) * (c.recoveryRate || 0) },
    // Values of the temperature field, not constants, and slots only in a case
    // that gives them (or the diffusivity) a slider. A temperature a slider
    // moves is written as a symbol, although a setpoint the case fixes is
    // written as its number. Only the heater's appears in an equation; the
    // other two are boundary values and have symbols so that no slot lacks one.
    { slot: 'wallTemperature', from: ['wallTemperature'], symbol: 'T_wall',
        value: (c) => (Number.isFinite(c.wallTemperature) ? c.wallTemperature : 0) },
    { slot: 'inletTemperature', from: ['inletTemperature'], symbol: 'T_feed',
        value: (c) => (Number.isFinite(c.inletTemperature) ? c.inletTemperature : 0) },
    { slot: 'heaterTemperature', from: ['heaterTemperature'], symbol: 'T_heat',
        value: (c) => (Number.isFinite(c.heaterTemperature) ? c.heaterTemperature : 0) },
    // The same letter the literal is given in the temperature equation, so a
    // case looks the same in the panel whether or not it offers the slider.
    coefficientOwnSlot('thermalDiffusivity', 'α'),
    // g times an expansion coefficient, thermal or solutal by the field it
    // multiplies.
    coefficientOwnSlot('buoyancy', 'gβ'),
    coefficientOwnSlot('damping', 'γ'),
    coefficientOwnSlot('potentialHeight', 'V_0'),
    coefficientOwnSlot('appliedField', 'B_0'),
    coefficientOwnSlot('appliedElectricField', 'E_0'),
];

// The slots by name, the ports' five each last (boundaryPortSlotList).
const COEFFICIENT_SLOTS = [...COEFFICIENT_SLOT_TABLE.map((row) => row.slot), ...boundaryPortSlotList()];

// Every slot's value from a case's constants, ports aside, which the case
// fills from its port list.
function coefficientSlotValues(constants) {
    return Object.fromEntries(COEFFICIENT_SLOT_TABLE.map((row) => [row.slot, row.value(constants)]));
}

// The slots a constant reaches the shader through.
function coefficientSlotsFedBy(name) {
    return COEFFICIENT_SLOT_TABLE.filter((row) => row.from.includes(name)).map((row) => row.slot);
}

// The symbol the panel writes a slot as, or undefined for a port's.
function coefficientSymbol(slot) {
    const row = COEFFICIENT_SLOT_TABLE.find((entry) => entry.slot === slot);
    return row && row.symbol;
}

// Validated, so a typo fails at the line that wrote it and not as a shader
// compile error after a viewer picks the case.
function coefficientSlot(name) {
    if (!COEFFICIENT_SLOTS.includes(name)) {
        throw new Error(`coefficientSlot: no slot named ${name}; the list is in coefficients.js`);
    }
    return { coefficientSlot: name };
}

function coefficientIsSlot(param) {
    return !!param && typeof param === 'object' && typeof param.coefficientSlot === 'string';
}

// Coefficients that vary in space

// A PROFILE: a slot or a number times a shape, given as an (at, wgsl) pair in
// position. The shape is at least one, so the slot holds the coefficient's
// smallest value. It is evaluated at each level's own points and never
// restricted, and a coefficient inside a flux reads it per face.

// The shape is checked on a grid this fine; a feature narrower than one sample
// is already narrower than any coarsest level can carry.
const COEFFICIENT_PROFILE_SAMPLES = 129;

// The base is a slot name, which a slider moves, or a number, a literal in the
// shader. A shape that dips below one fails here, at the line that wrote it.
function coefficientProfile(name, profile) {
    const literal = typeof name === 'number';
    if (literal ? !(Number.isFinite(name) && name > 0) : !COEFFICIENT_SLOTS.includes(name)) {
        throw new Error(`coefficientProfile: ${name} is neither a slot (the list is in coefficients.js) `
            + 'nor a positive number');
    }
    if (!profile || typeof profile.at !== 'function' || typeof profile.wgsl !== 'string') {
        throw new Error(`coefficientProfile: the shape for ${name} is a positionProfile`);
    }

    let least = Infinity;
    const samples = COEFFICIENT_PROFILE_SAMPLES;
    for (let row = 0; row < samples; row++) {
        for (let column = 0; column < samples; column++) {
            const value = profile.at(column / (samples - 1), row / (samples - 1));
            if (!Number.isFinite(value)) {
                throw new Error(`coefficientProfile: the shape for ${name} returned ${value}`);
            }
            least = Math.min(least, value);
        }
    }
    if (least < 1) {
        throw new Error(`coefficientProfile: the shape for ${name} falls to ${least}, below one. `
            + 'A shape multiplies its slot and must be at least one everywhere, so that the slot '
            + 'holds the smallest value the coefficient takes. Declare the slot at the smaller '
            + 'value and raise the shape instead.');
    }
    return { coefficientProfile: {
        slot: literal ? undefined : name,
        base: literal ? name : { coefficientSlot: name },
        at: profile.at, wgsl: profile.wgsl,
    } };
}

function coefficientIsProfile(param) {
    return !!param && typeof param === 'object' && !!param.coefficientProfile;
}

// Coefficients a viewer paints

// A PAINTED coefficient reads an array in the grid buffer, at one location and
// only at a row's own point there: zero means the bare value, anything else the
// painted value times that strength. Each array is painted at its own points
// on every level (paintMaterials in geometry.js), so nothing is averaged or restricted.
const PAINT_ARRAY_LOCATIONS = {
    paintCatalystCenter: CENTER,
    paintPorousXFace: XFACE,
    paintPorousYFace: YFACE,
};

function paintArrayLocation(name) {
    if (!(name in PAINT_ARRAY_LOCATIONS)) {
        throw new Error(`no painted array named ${name}; the list is in coefficients.js`);
    }
    return PAINT_ARRAY_LOCATIONS[name];
}

// `bare` and `painted` are each a slot or a number. Open fluid's drag is the
// number zero, so an unpainted momentum row is the unpainted one exactly.
function coefficientPainted(array, bare, painted) {
    paintArrayLocation(array);
    for (const value of [bare, painted]) {
        if (!(typeof value === 'number' || coefficientIsSlot(value))) {
            throw new Error('a painted coefficient takes a number or a slot on either side, '
                + `not ${JSON.stringify(value)}`);
        }
    }
    return { coefficientPainted: { array, bare, painted } };
}

function coefficientIsPainted(param) {
    return !!param && typeof param === 'object' && !!param.coefficientPainted;
}

// A coefficient's value in JavaScript, at `position` (anything carrying x and
// y, and p for a painted one). A varying coefficient with no point to read it
// at throws, since its base value would be a plausible wrong number.
function coefficientValueOf(plate, param, position) {
    if (coefficientIsPainted(param)) {
        const { array, bare, painted } = param.coefficientPainted;
        if (!plate) throw new Error(`a painted coefficient on ${array} was resolved with no plate`);
        if (!position || position.p === undefined) {
            throw new Error(`a painted coefficient on ${array} was resolved with no flat index; `
                + 'the caller has to pass the point it is evaluating at');
        }
        if (position.location !== undefined && position.location !== paintArrayLocation(array)) {
            throw new Error(`a painted coefficient on ${array} was read on a row at another `
                + 'location; a painted array is read only at its own points');
        }
        const strength = plate[array][position.p];
        return strength > 0 ? coefficientValueOf(plate, painted) * strength
            : coefficientValueOf(plate, bare);
    }
    if (coefficientIsProfile(param)) {
        const { base, at } = param.coefficientProfile;
        if (!position) {
            throw new Error(`a coefficient on ${JSON.stringify(base)} carries a profile and was `
                + 'resolved with no position; the caller has to pass the evaluation point');
        }
        return coefficientValueOf(plate, base) * at(position.x, position.y);
    }
    if (!coefficientIsSlot(param)) return param;
    if (!plate) throw new Error(`coefficient slot ${param.coefficientSlot} was resolved with no plate`);
    return plate.coefficientValue(param.coefficientSlot);
}

// The same coefficient as WGSL. A profile's shape is printed inline in the
// `position` every stencil has in scope.
// A painted array is read at `index`, the point's flat index as the caller
// names it.
function coefficientCodeOf(param, index = 'p') {
    if (coefficientIsPainted(param)) {
        const { array, bare, painted } = param.coefficientPainted;
        const strength = `grid.${array}[${index}]`;
        return `select(${coefficientCodeOf(bare)}, ${coefficientCodeOf(painted)} * ${strength}, `
            + `${strength} > 0.0)`;
    }
    if (coefficientIsProfile(param)) {
        const { base, wgsl } = param.coefficientProfile;
        return `(${coefficientCodeOf(base)} * (${wgsl}))`;
    }
    if (!coefficientIsSlot(param)) return wgslLiteral(param);
    return `coefficients.${param.coefficientSlot}`;
}

// A PROFILE: a value given as a function of position, written once as a WGSL
// expression in position.x and position.y. The host evaluates the same text,
// since WGSL's arithmetic, comparisons and && read the same in JavaScript; only
// select(otherwise, then, condition) and the few builtins a profile uses are
// defined for it.
function positionProfile(wgsl) {
    const evaluate = new Function('position', 'select', 'sqrt', 'abs', 'min', 'max', 'exp',
        `return (${wgsl});`);
    const select = (otherwise, then, condition) => (condition ? then : otherwise);
    const at = (x, y) => evaluate({ x, y }, select, Math.sqrt, Math.abs, Math.min, Math.max, Math.exp);
    return { at, wgsl };
}
