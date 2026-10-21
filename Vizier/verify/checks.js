// checks.js, by Allen Rakhamimov.
// The one list of checks, and the one reading of a check's output.
//
// verify.html reads this file: it loads each check as a plain script and runs
// them one after another.

'use strict';

// Grouped by what they check, the storage first. None of them runs the solver:
// the GPU checks on verify.html do that.
const VERIFY_CHECKS = [
    {
        file: 'verify_layout.js', stage: 'grid',
        what: 'where each value is stored, and which cells are boundaries',
        highlights: [/interior face count|^ *\d+ +\d+ +\d/],
    },
    {
        file: 'verify_geometry.js', stage: 'grid',
        what: 'shapes, carving, and what survives on coarse levels',
        highlights: [/survives$|vanishes$/, /^\d+ +\d+ +(open|CLOSED)/],
    },
    {
        file: 'verify_sandbox.js', stage: 'cases',
        what: 'the sandbox\'s ports, shapes, paint and refusals, with one shader for every layout',
        highlights: [/faces at/, /layouts against the default/, /refused for their own reason/,
            /porous faces placed/],
    },
    {
        file: 'verify_boundary_values.js', stage: 'cases',
        what: 'boundary values a slider moves, and every slider reaching the shader',
        highlights: [/listed values read/, /T0 \d/],
    },
    {
        file: 'verify_rate_laws.js', stage: 'cases',
        what: 'the same Damkohler number for each of a case\'s rate laws',
    },
    {
        file: 'verify_buoyancy.js', stage: 'cases',
        what: 'buoyant cases, and zero viscosity shown as requested',
    },
    {
        file: 'verify_storage.js', stage: 'cases',
        what: 'the GPU memory each case needs at 1024 cells',
        highlights: [/the largest buffer at 1024/],
    },
    {
        file: 'verify_equations.js', stage: 'page',
        what: 'the panel\'s equations, their signs against the shader, and the Oregonator against Field\'s',
        highlights: [/distinct systems among them/],
    },
    {
        file: 'verify_reactions.js', stage: 'page',
        what: 'each reaction line the panel writes, against the terms tagged with it',
    },
    {
        file: 'verify_views.js', stage: 'page',
        what: 'the views and species each case offers, against the arms the draw shader takes',
    },
    {
        file: 'verify_page.js', stage: 'page',
        what: 'the panel, the legend and the Build card refreshing for every case and view',
    },
    {
        file: 'verify_vision.js', stage: 'page',
        what: 'simulated color vision, matching the browser\'s own',
        highlights: [/against the matrix applied in linear light/, /pure red under protanopia/],
    },
    {
        file: 'verify_kernels.js', stage: 'shader',
        what: 'the GPU entry points each case generates',
        highlights: [/entry points for three fields/],
    },
    {
        file: 'check_gpu_shader.js', stage: 'shader',
        what: 'every case\'s shader read as text',
        highlights: [/collisions$/, /reserved$/, /unresolved$/],
    },
    {
        file: 'verify_frame.js', stage: 'shader',
        what: 'every kernel a frame dispatches, against the kernels its shader generates',
    },
];

function verifyFinishCheck(check, status, failure, output, seconds) {
    const result = { status, error: failure };

    // "33 checks passed." if the check reports a count.
    const countMatch = output.match(/(\d+) checks passed\./);
    const checks = countMatch ? Number(countMatch[1]) : null;

    // A check that threw is a failure even if it printed something reassuring
    // first.
    const crashed = result.status === null || result.error !== undefined;
    const passed = !crashed && result.status === 0;

    // Checks print either "FAIL  <detail>" inline, or "N FAILED:" followed by
    // an indented list. Both are captured, so a failure count always comes with
    // what failed.
    const lines = output.split('\n');
    const failureLines = [];
    for (let k = 0; k < lines.length; k++) {
        const line = lines[k];
        if (/^\s*\d+ FAILED:/.test(line)) {
            for (let m = k + 1; m < lines.length; m++) {
                if (!/^\s{2,}\S/.test(lines[m])) break;
                failureLines.push(lines[m]);
            }
            continue;
        }
        if (/FAIL/.test(line)) failureLines.push(line);
    }

    return { check, output, checks, seconds, passed, crashed, failureLines, status: result.status };
}

function verifyHighlights(check, output) {
    if (!check.highlights) return [];
    const lines = output.split('\n');
    const kept = [];
    for (const pattern of check.highlights) {
        for (const line of lines) {
            if (pattern.test(line) && line.trim().length > 0 && !kept.includes(line)) kept.push(line);
        }
    }
    return kept;
}

// The groups, in words, which the page shows in place of the codes.
const VERIFY_STAGE_GROUPS = [
    { stages: ['grid'], title: 'The grid',
      text: 'Storage, how the grid levels line up, and which cells are solid.' },
    { stages: ['cases'], title: 'The cases',
      text: 'What the cases declare, the sandbox\'s rules, and the sliders.' },
    { stages: ['page'], title: 'The page',
      text: 'The equations and reactions the panel prints, the views each case offers, '
          + 'the page\'s refresh, and the simulated color vision.' },
    { stages: ['shader'], title: 'The shader, without a GPU',
      text: 'Each case\'s shader, read as text for the mistakes a generator makes, and the '
          + 'kernels a frame dispatches.' },
];

// A check is a plain script that calls verifyCheck with its body. Loading it
// registers the body here; verify.html then runs it.
const verifyCheckBodies = new Map();

function verifyCheck(file, body) {
    verifyCheckBodies.set(file, body);
}

function verifyCheckBody(file) {
    return verifyCheckBodies.get(file);
}

// The file-prefixed calls a page makes, which is how the static check and the
// verification page both decide whether page.js calls a helper nothing
// defines. A name like diagnosticsSlug can only come from diagnostics.js, while
// an unprefixed name may be local to the page; a function the page declares
// itself is not a cross-file call.
function verifyPrefixedCalls(pageText) {
    const prefixes = ['diagnostics', 'controls', 'app', 'case', 'runtime',
        'kernels', 'draw', 'grid', 'fields', 'geometry', 'coefficients', 'system',
        'multigrid', 'boundary', 'operators', 'equations', 'terms', 'monitors',
        'page', 'editor', 'legend', 'panel', 'sandbox', 'capture', 'views', 'display',
        'physics', 'profile'];
    // A call is a name not after a dot or another name, or after a spread.
    const pattern = new RegExp(`(?:(?<![.\\w])|(?<=\\.\\.\\.))((?:${prefixes.join('|')})[A-Z]\\w*)\\s*\\(`, 'g');
    const called = new Set();
    for (const match of pageText.matchAll(pattern)) called.add(match[1]);
    for (const match of pageText.matchAll(/function\s+([A-Za-z_]\w*)\s*\(/g)) called.delete(match[1]);
    return [...called].sort();
}
