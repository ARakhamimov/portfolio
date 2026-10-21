// equationPanel.js, by Allen Rakhamimov.
// The equations and reactions the panel beside the picture sets, from the
// case's own system.
//
// The solver never learns what a field means; this file holds the symbols a
// viewer wants (C_A for a concentration, nu for a viscosity). A field's symbol
// lives in FIELD_SPEC beside its label; the tables here are for vectors and
// coefficients. Each dictionary entry writes its own term (describe), and this
// file only chooses the letters and sets the result. Nothing in the solver
// depends on it.

'use strict';

// Symbols

// A term that names two components is transporting with a vector, and a viewer
// reads (u.grad)C far more easily than a pair of components.
const PANEL_VECTOR_SYMBOLS = [
    { components: ['xVelocity', 'yVelocity'], symbol: '**u**' },
    { components: ['fluxX', 'fluxY'],
      symbol: { electrostatics: '**D**', magnetostatics: '**B**', telegraph: '**J**' } },
];

// A mechanism's literal rates, by the term's reaction tag and the species the
// term is on, since one step puts a different multiple of its constant on each
// species it touches (step c makes one HBrO2 net and two Ce(IV)).
const PANEL_MECHANISM_SYMBOLS = {
    // Step e has no entry: its two rates are slots and carry their symbols.
    a: { speciesA: 'k_a', speciesB: 'k_a' },
    b: { speciesA: 'k_b', speciesB: 'k_b' },
    c: { speciesA: 'k_c', speciesC: '2k_c' },
    // 2X -> P enters HBrO2's balance as -2 k_d X^2, so the term is 2k_d and the
    // event rate on the arrow is k_d.
    d: { speciesA: '2k_d', event: 'k_d' },
};

// A literal coefficient has no slot to be named by, so it is named by the job
// it does in the term that reads it, by kind and then by field and physics.
const PANEL_LITERAL_SYMBOLS = {
    // The magnetic diffusivity is eta, on the induction equation; the other
    // physics that solve the potential carry no literal diffusivity on it.
    diffusivity:    { temperature: '\u03b1', default: 'D', potential: { mhd: '\u03b7' } },
    // On a flux row, the literal first order sink is the material's inverse
    // permittivity or permeability, bracketed as a quotient; which one depends
    // on the physics, so the entry is a table keyed by it.
    rate:           { default: 'k_f',
                      fluxX: { electrostatics: '(1/\u03b5)', magnetostatics: '(1/\u03bc)' },
                      fluxY: { electrostatics: '(1/\u03b5)', magnetostatics: '(1/\u03bc)' } },
    halfSaturation: { default: 'K' },
    // A charge density is rho, the letter every electrostatics text uses.
    source:         { default: 'S', potential: { electrostatics: '\u03c1' } },
    target:         { default: 'C*' },
    // proportionalSource's coefficient. Every case that uses the entry uses it
    // for buoyancy, so a literal one is named for that job.
    coupling:       { default: 'g\u03b2' },
    // laplacianOf's coefficient, which only a wave function carries.
    dispersion:     { default: '(\u0127/2m)' },
};

function panelFieldSymbol(name, physics) {
    const symbol = fieldPresentationOf(name, 'symbol', physics);
    if (!symbol) throw new Error(`no symbol for field ${name}; give it one in FIELD_SPEC`);
    return symbol;
}

function panelVectorSymbol(names, physics) {
    const found = PANEL_VECTOR_SYMBOLS.find((entry) =>
        entry.components.length === names.length
        && entry.components.every((name, index) => name === names[index]));
    // With no vector declared for the pair, the components themselves are still
    // a true statement of what the term transports with.
    return found ? panelByPhysics(found.symbol, `the vector (${names})`, physics)
        : `(${names.map((name) => panelFieldSymbol(name, physics)).join(', ')})`;
}

function panelCoefficientSymbol(param, kind, field, reaction, physics) {
    // A coefficient that varies in space is written with its argument (x, y),
    // as a temperature-dependent rate is written k(T).
    if (coefficientIsProfile(param)) {
        const base = panelCoefficientSymbol(param.coefficientProfile.base, kind, field, undefined, physics);
        return `${base}(x, y)`;
    }
    // A painted coefficient varies in space the same way, and is written by
    // its bare value's symbol, or by the painted one's where bare is zero.
    if (coefficientIsPainted(param)) {
        const { bare, painted } = param.coefficientPainted;
        const named = coefficientIsSlot(bare) ? bare : painted;
        return `${panelCoefficientSymbol(named, kind, field, undefined, physics)}(x, y)`;
    }
    if (coefficientIsSlot(param)) {
        const symbol = coefficientSymbol(param.coefficientSlot);
        if (!symbol) {
            throw new Error(`no symbol for coefficient slot ${param.coefficientSlot}; `
                + 'the table is in coefficients.js');
        }
        return symbol;
    }
    if (kind === 'rate' && reaction && PANEL_MECHANISM_SYMBOLS[reaction]) {
        const symbol = PANEL_MECHANISM_SYMBOLS[reaction][field];
        if (!symbol) throw new Error(`no symbol for step ${reaction} on ${field}; the table is in equationPanel.js`);
        return symbol;
    }
    const byKind = PANEL_LITERAL_SYMBOLS[kind];
    if (!byKind) throw new Error(`no symbol for a literal coefficient of kind ${kind}`);
    return panelByPhysics(byKind[field] || byKind.default, `a literal ${kind} on ${field}`, physics);
}

// A display table keyed by physics. A plain string is the same everywhere.
function panelByPhysics(value, what, physics) {
    if (typeof value === 'string') return value;
    if (!(physics in value)) throw new Error(`no symbol for ${what} under physics ${physics}`);
    return value[physics];
}

// Bound to one physics, the system's own, because the flux pair is D, B or J
// by which physics a system is.
function panelSymbols(physics) {
    return {
        field:       (name) => panelFieldSymbol(name, physics),
        vector:      (names) => panelVectorSymbol(names, physics),
        coefficient: (param, kind, field, reaction) =>
            panelCoefficientSymbol(param, kind, field, reaction, physics),
    };
}

// The equations

// What the equation panel sets: each term's describe, with the symbols the
// caller supplies (field, vector, and coefficient by slot or by kind), so
// nothing here knows what a field stands for. The bodies use a three-rule
// notation that serves HTML and plain text: `_x` a subscript, `^2` a
// superscript ending at its last digit, `**u**` bold.

// A list of concentrations with repeats written as powers, so U + 2V -> 3V
// reads k C_A C_B^2 and not k C_A C_B C_B.
function describeProduct(names, symbolOf) {
    const counted = [];
    for (const name of names || []) {
        const seen = counted.find((entry) => entry.name === name);
        if (seen) seen.power += 1;
        else counted.push({ name, power: 1 });
    }
    return counted
        .map(({ name, power }) => (power > 1 ? `${symbolOf(name)}^${power}` : symbolOf(name)))
        .join(' ');
}

function describeTerm(equation, spec, symbols) {
    const entry = TERM_DICTIONARY[spec.term];
    const field = (name) => symbols.field(name);
    // The reaction tag goes along, so a literal rate in a mechanism is named by
    // its step.
    const coefficient = (param, kind) => symbols.coefficient(param, kind, equation.field, spec.reaction);

    return entry.describe({
        params: spec,
        symbol: field(equation.field),
        fieldSymbol: field,
        vector: (names) => symbols.vector(names),
        coefficient,
        product: (names) => describeProduct(names, field),

        // A rate that reads a field is written with its argument, k(T).
        rate(param) {
            if (!rateIsArrhenius(param)) return coefficient(param, 'rate');
            return `${coefficient(param.arrhenius.rate, 'rate')}(${field(param.arrhenius.field)})`;
        },

        // A setpoint is a value of the field, so it is written as its number:
        // F (1 - C_A), not F (C_A* - C_A).
        value(param) {
            return (typeof param === 'number') ? String(param) : coefficient(param, 'target');
        },
    });
}

// One equation as a left and a right half. A row with no left side, such as
// the divergence constraint, is written against zero.
function describeEquation(equation, symbols) {
    const left = [];
    const right = [];
    for (const spec of equation.terms) {
        const written = describeTerm(equation, spec, symbols);
        if (written.side === 'left') left.push(written.body);
        else right.push({ term: spec.term, sign: written.sign, body: written.body });
    }
    if (left.length > 1) throw new Error(`equation for ${equation.field} has ${left.length} left-hand terms`);
    if (!right.length) throw new Error(`equation for ${equation.field} has nothing on the right`);
    if (left.length) return { field: equation.field, left: left[0], right };

    // An equation against zero is multiplied through by minus one when that
    // lets the first term lead without a sign: -div u = 0 prints as div u = 0.
    const flip = right[0].sign === '-';
    return {
        field: equation.field,
        left: null,
        right: flip ? right.map((term) => ({ ...term, sign: term.sign === '-' ? '+' : '-' })) : right,
    };
}

// The same equation as one line of text, for a run export, without the bold.
function describeText(described) {
    const body = described.right
        .map((term, index) => {
            if (index === 0) return term.sign === '-' ? `−${term.body}` : term.body;
            return `${term.sign === '-' ? '−' : '+'} ${term.body}`;
        })
        .join(' ')
        .replace(/\*\*/g, '');
    return described.left ? `${described.left} = ${body}` : `${body} = 0`;
}

// The three rules the dictionary writes its bodies in. Escaping comes first, so
// a symbol table someone later fills with an angle bracket cannot reach the page
// as markup.
function panelMarkup(text) {
    return text
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
        .replace(/_([A-Za-z0-9]+)/g, '<sub>$1</sub>')
        .replace(/\^([0-9]+|[A-Za-z][A-Za-z0-9]*)/g, '<sup>$1</sup>');
}

// Each term is one span, and the spans are separated by ordinary spaces, so a
// line too long for a 360px column wraps between terms and never inside one.
function panelEquationHtml(described) {
    const pieces = [];
    if (described.left) pieces.push(`${panelMarkup(described.left)} =`);
    for (const [index, term] of described.right.entries()) {
        const body = panelMarkup(term.body);
        if (index === 0) pieces.push(term.sign === '-' ? `\u2212\u2009${body}` : body);
        else pieces.push(`${term.sign === '-' ? '\u2212' : '+'} ${body}`);
    }
    if (!described.left) pieces.push('= 0');
    return pieces.map((piece) => `<span>${piece}</span>`).join(' ');
}

// The lines under the equations, saying what k(T), D(T) or the total
// potential A stand for, each only where the case has one.
function panelEquationNotes(system) {
    const coupled = system.equations.some((equation) =>
        equation.terms.some((term) => rateIsArrhenius(term.rate)));
    const diffusing = system.equations.some((equation) =>
        equation.terms.some((term) => term.term === 'diffusion' && rateIsArrhenius(term.diffusivity)));
    const notes = [];
    if (coupled) {
        notes.push('<p class="note">k(T) = k<sub>0</sub> exp(s (T \u2212 T<sub>0</sub>)), with '
            + 'T<sub>0</sub> held at the feed temperature the case opens with, so every rate in this '
            + 'case runs faster where the fluid is hot.</p>');
    }
    if (diffusing) {
        notes.push('<p class="note">D(T) = D<sub>0</sub> exp(s<sub>D</sub> (T \u2212 T<sub>0</sub>)), '
            + 'the form a rate takes, with T<sub>0</sub> the feed temperature, so diffusion is '
            + 'faster where the medium is hot.</p>');
    }
    const lorentz = system.equations.flatMap((equation) => equation.terms)
        .find((term) => term.term === 'lorentzForce');
    if (lorentz) {
        const applied = lorentz.along === 'x' ? 'B<sub>0</sub> y' : '\u2212B<sub>0</sub> x';
        notes.push(`<p class="note">A = ${applied} + a: the applied field's potential plus the `
            + 'induced part the case solves, with the field B = (\u2202A/\u2202y, '
            + '\u2212\u2202A/\u2202x) and the current out of the plane j = \u2212\u2207<sup>2</sup>A. '
            + 'B is in units in which B<sub>0</sub> is the Alfv\u00e9n speed.</p>');
        const driven = system.equations.some((equation) => equation.field === 'potential'
            && equation.terms.some((term) => term.term === 'source'));
        if (driven) {
            notes.push('<p class="note">E<sub>0</sub> is an applied electric field out of the plane, '
                + 'driven by electrodes in front of and behind the channel. It pushes a current '
                + 'through the fluid, and the current across the field pushes the fluid.</p>');
        }
    }
    return notes.join('');
}

// The reactions, in formula form
//
// Every reaction term carries its reaction's name, so the terms gather back
// into a formula. A term CONSUMES its equation's species (a sink) or PRODUCES
// it (a source), at a rate proportional to its FACTORS, the species the rate
// law multiplies, which are the reaction's left-hand side. The EVENT rate is
// read off one reference term, its first source or else its first sink over
// the rate law's order in the species it consumes (2A -> enters as -2k A^2, so
// the event rate is k); each term's rate over the event rate is that species'
// coefficient. A factor nothing consumes stands on both sides (a catalyst, an
// autocatalyst), and a tagged heat source says the reaction releases heat.
// Each dictionary entry a reaction term can be says how it reads (reaction).

// The host value of a rate, without its temperature factor or its shape: the
// part two terms of one reaction can be compared by.
function panelRateBase(rate, values) {
    const base = rateIsArrhenius(rate) ? rate.arrhenius.rate : rate;
    if (coefficientIsProfile(base)) return panelRateBase(base.coefficientProfile.base, values);
    if (coefficientIsPainted(base)) return panelRateBase(base.coefficientPainted.bare, values);
    if (coefficientIsSlot(base)) return values[base.coefficientSlot];
    return base;
}

function panelFactorKey(factors) {
    return factors.slice().sort().join(' ');
}

// One entry per reaction, in the order its first term appears. `values` is the
// slot table the coefficients buffer is written from, so a coefficient a
// slider moves moves the stoichiometry that depends on it.
function panelReactions(system, values = appCoefficientValues()) {
    const groups = new Map();
    for (const equation of system.equations) {
        for (const term of equation.terms) {
            if (!term.reaction) continue;
            const read = TERM_DICTIONARY[term.term].reaction;
            if (!read) {
                throw new Error(`a ${term.term} term is tagged as part of reaction ${term.reaction}, `
                    + 'and the reaction line knows no rate law of that shape');
            }
            if (!groups.has(term.reaction)) {
                groups.set(term.reaction, { name: term.reaction, entries: [], exothermic: false });
            }
            const group = groups.get(term.reaction);
            const said = read(equation.field, term);
            if (!fieldSpecOf(equation.field).formula) {
                if (said.produces) group.exothermic = true;
                continue;
            }
            group.entries.push({ field: equation.field, rate: term.rate, ...said });
        }
    }

    const order = system.equations.map((equation) => equation.field);
    const reactions = [];
    for (const group of groups.values()) {
        if (!group.entries.length) continue;
        const reference = group.entries.find((entry) => entry.produces) || group.entries[0];
        const referenceChange = reference.produces ? 1
            : reference.factors.filter((factor) => factor === reference.consumes).length;
        const scale = panelRateBase(reference.rate, values) / referenceChange;
        const consumed = {}, produced = {}, multiplied = {};
        for (const entry of group.entries) {
            const share = panelRateBase(entry.rate, values) / scale;
            if (entry.consumes) consumed[entry.consumes] = (consumed[entry.consumes] || 0) + share;
            if (entry.produces) produced[entry.produces] = (produced[entry.produces] || 0) + share;
        }
        for (const factor of reference.factors) multiplied[factor] = (multiplied[factor] || 0) + 1;

        const left = [], right = [];
        for (const field of order) {
            const before = consumed[field] > 0 ? consumed[field] : (multiplied[field] || 0);
            const after = before - (consumed[field] || 0) + (produced[field] || 0);
            if (before > 1e-9) left.push([before, field]);
            if (after > 1e-9) right.push([after, field]);
        }
        reactions.push({
            name: group.name, left, right, rate: reference.rate, field: reference.field, scale,
            change: referenceChange,
            exothermic: group.exothermic,
            factorsAgree: group.entries.every((entry) =>
                panelFactorKey(entry.factors) === panelFactorKey(reference.factors)),
        });
    }
    return reactions;
}

function panelReactionSide(side) {
    if (!side.length) return '\u2205';
    return side.map(([amount, field]) => {
        const rounded = Math.round(amount);
        const coefficient = Math.abs(amount - 1) < 1e-9 ? ''
            : Math.abs(amount - rounded) < 1e-9 ? `${rounded} ` : `${displayNumberText(amount)} `;
        return coefficient + fieldSpecOf(field).formula;
    }).join(' + ');
}

// The rate written the way the equations write it, so k(T) on the arrow is
// the k(T) in the balances below.
function panelReactionRate(reaction) {
    const rate = reaction.rate;
    // The arrow carries the EVENT rate: the reference term's rate over its own
    // stoichiometric change. A mechanism table may name it directly; otherwise
    // a change other than one is written as a division.
    if (!rateIsArrhenius(rate)) {
        const mechanism = PANEL_MECHANISM_SYMBOLS[reaction.name];
        if (mechanism && mechanism.event) return mechanism.event;
        const symbol = panelCoefficientSymbol(rate, 'rate', reaction.field, reaction.name);
        return reaction.change === 1 ? symbol : `(${symbol})/${reaction.change}`;
    }
    return `${panelCoefficientSymbol(rate.arrhenius.rate, 'rate', reaction.field)}`
        + `(${panelFieldSymbol(rate.arrhenius.field)})`;
}

function panelReactionText(system) {
    return panelReactions(system).map((reaction) =>
        `${panelReactionSide(reaction.left)} -> ${panelReactionSide(reaction.right)}`
        + `   [rate ${panelReactionRate(reaction)}${reaction.exothermic ? ', releases heat' : ''}]`);
}

function panelReactionHtml(system) {
    const reactions = panelReactions(system);
    if (!reactions.length) return '';
    return '<div class="reactions">' + reactions.map((reaction) =>
        `<div class="reaction">${panelReactionSide(reaction.left)} `
        + `<span class="reactionArrow"><span class="reactionRate">`
        + `${panelMarkup(panelReactionRate(reaction))}</span>\u27f6</span> `
        + `${panelReactionSide(reaction.right)}`
        + (reaction.exothermic ? '<span class="reactionHeat">releases heat</span>' : '')
        + '</div>').join('') + '</div>';
}

// The same equations as plain text, for a run export. A file recording what a
// case did should say which equations it was solving while it did it.
function panelEquationText(system) {
    const symbols = panelSymbols(system.physics);
    return system.equations.map((equation) => describeText(describeEquation(equation, symbols)));
}

// Rebuilt only when the equations change, which is only when the case does.
let panelEquationSignature = null;

function panelSyncEquations(system) {
    const host = document.getElementById('equations');
    if (!host) return;

    const signature = `${system.name}|${panelReactionText(system).join('\n')}|`
        + panelEquationText(system).join('\n');
    if (signature === panelEquationSignature) return;
    panelEquationSignature = signature;

    const symbols = panelSymbols(system.physics);
    host.innerHTML = panelReactionHtml(system) + system.equations
        .map((equation) =>
            `<div class="equation">${panelEquationHtml(describeEquation(equation, symbols))}</div>`)
        .join('')
        + panelEquationNotes(system);
}
