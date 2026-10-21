// fields.js, by Allen Rakhamimov.
// The fields Vizier can solve, and the arrays each one is given.
//
// FIELD_SPEC is the one list: allocation order, the WGSL structs and every
// array name follow from it. Labels and symbols sit here beside the field for
// the display; nothing in the solver reads them.

'use strict';

// One row per field. A solved field gets residual, right-hand side and
// restricted arrays for the multigrid cycle, and a field with history gets one
// stored previous time level. Pressure is solved with no history, because it
// enforces a constraint at the new level only. label, symbol and formula are
// the display's; nothing in the solver reads them.
const FIELD_SPEC = [
    { name: 'temperature', location: CENTER, solved: true,  history: true,  label: 'temperature', symbol: 'T'   },
    { name: 'pressure',    location: CENTER, solved: true,  history: false, label: 'pressure',    symbol: 'p'   },
    { name: 'speciesA',    location: CENTER, solved: true,  history: true,  label: 'species A',   symbol: 'C_A', formula: 'A' },
    { name: 'speciesB',    location: CENTER, solved: true,  history: true,  label: 'species B',   symbol: 'C_B', formula: 'B' },
    { name: 'speciesC',    location: CENTER, solved: true,  history: true,  label: 'species C',   symbol: 'C_C', formula: 'C' },
    { name: 'speciesD',    location: CENTER, solved: true,  history: true,  label: 'species D',   symbol: 'C_D', formula: 'D' },
    { name: 'xVelocity',   location: XFACE,  solved: true,  history: true,  label: 'x velocity',  symbol: 'u'   },
    { name: 'yVelocity',   location: YFACE,  solved: true,  history: true,  label: 'y velocity',  symbol: 'v'   },
    // A potential and a flux, for the electric, magnetic and telegraph cases.
    // Each names a different quantity in each physics, so its label and
    // symbol are keyed by physics (fieldPresentationOf).
    { name: 'potential',   location: CENTER, solved: true,  history: true,
      label:  { electrostatics: 'potential', magnetostatics: 'potential', telegraph: 'voltage',
                mhd: 'induced potential' },
      symbol: { electrostatics: 'φ', magnetostatics: 'ψ', telegraph: 'V', mhd: 'a' } },
    { name: 'fluxX',       location: XFACE,  solved: true,  history: true,
      label:  { electrostatics: 'x displacement', magnetostatics: 'x magnetic field', telegraph: 'x current' },
      symbol: { electrostatics: 'D_x', magnetostatics: 'B_x', telegraph: 'J_x' } },
    { name: 'fluxY',       location: YFACE,  solved: true,  history: true,
      label:  { electrostatics: 'y displacement', magnetostatics: 'y magnetic field', telegraph: 'y current' },
      symbol: { electrostatics: 'D_y', magnetostatics: 'B_y', telegraph: 'J_y' } },
    // The real and imaginary parts of a wave function, for the Schrodinger
    // cases.
    { name: 'waveReal',      location: CENTER, solved: true, history: true,
      label: 'real part',      symbol: 'ψ_R' },
    { name: 'waveImaginary', location: CENTER, solved: true, history: true,
      label: 'imaginary part', symbol: 'ψ_I' },
    { name: 'divergence',  location: CENTER, solved: false, history: false, label: 'divergence',  symbol: '∇·**u**' },
    // Display only: the streamline overlay's stream function, held at cell
    // corners in a center-shaped array. A capital, since psi is a potential.
    { name: 'streamFunction', location: CENTER, solved: false, history: false,
      label: 'stream function', symbol: 'Ψ' },
];

// A field's entry by name. A name not in the table is an error.
function fieldSpecOf(name) {
    const entry = FIELD_SPEC.find((field) => field.name === name);
    if (!entry) throw new Error(`fieldSpecOf: no field named ${name} in FIELD_SPEC`);
    return entry;
}

// A field's label or symbol for the physics a case runs. A physics missing from
// a keyed table is an error, never a borrowed name.
function fieldPresentationOf(name, property, physics) {
    const value = fieldSpecOf(name)[property];
    if (typeof value === 'string' || value === undefined) return value;
    if (!(physics in value)) {
        throw new Error(`field ${name} has no ${property} for physics ${physics}; add one in FIELD_SPEC`);
    }
    return value[physics];
}

// One health slot per field that can be solved, so a system never lists more
// equations than there are slots.
const FIELD_HEALTH_SLOTS = FIELD_SPEC.filter((f) => f.solved).length;

// The registry as arrays, in allocation order. The allocation and the WGSL
// structs both take their order from here, so they cannot disagree. Only the
// fields in `fields` get arrays, their state and, for a solved one, its
// multigrid workspace; every field gets them when it is left out.
function expandFieldSpec(spec, fields) {
    const arrays = [];
    for (const f of spec) {
        if (fields && !fields.includes(f.name)) continue;
        arrays.push({ name: f.name, location: f.location, role: 'value', field: f.name });
        if (f.history) {
            arrays.push({ name: `${f.name}Old`, location: f.location, role: 'history', field: f.name });
        }
    }
    for (const f of spec) {
        if (!f.solved) continue;
        if (fields && !fields.includes(f.name)) continue;
        arrays.push({ name: `${f.name}Residual`,   location: f.location, role: 'residual',   field: f.name });
        arrays.push({ name: `${f.name}RightHandSide`, location: f.location, role: 'rightHandSide',        field: f.name });
        arrays.push({ name: `${f.name}Restricted`, location: f.location, role: 'restricted', field: f.name });
    }
    return arrays;
}

// The WGSL names for one field's arrays, in the shape every emitter expects.
function arrayNamesFor(field, location, options = {}) {
    const at = (role, suffix) => `${bufferGroupFor(location, role)}.${field}${suffix}`;
    const names = {
        value: at('value', ''),
        rightHandSide: at('rightHandSide', 'RightHandSide'),
        residual: at('residual', 'Residual'),
        restricted: at('restricted', 'Restricted'),
    };
    if (options.history !== false) names.history = at('history', 'Old');
    return names;
}

// The arrays of a field given by name, as a cross-field term holds it.
function arrayNamesOfField(name) {
    const spec = FIELD_SPEC.find((f) => f.name === name);
    if (!spec) throw new Error(`no field named ${name} in FIELD_SPEC`);
    return arrayNamesFor(name, spec.location, { history: spec.history !== false });
}

// The fields a running system gets arrays for: those it solves, plus the two
// shown and never solved where they mean something, the divergence wherever
// there is a velocity and the stream function wherever there is a flow to draw
// streamlines of. The page's plate allocates these and nothing else.
function simulationFields(system) {
    const fields = system.equations.map((equation) => equation.field);
    if (kernelsHasVelocity(system)) fields.push('divergence');
    if (divergenceFreePair(system)) fields.push('streamFunction');
    return fields;
}
