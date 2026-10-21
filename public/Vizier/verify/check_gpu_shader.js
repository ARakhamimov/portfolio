// check_gpu_shader.js, by Allen Rakhamimov.
// The static check on the assembled WGSL.
//
// It cannot execute WGSL. It assembles the source the browser will compile and
// looks for the failures a generator produces: unbalanced delimiters, calls to
// functions nothing defines, names defined twice, and JavaScript values pasted
// into the text. It does not replace the GPU checks on verify.html; it catches
// a typo before a GPU run is spent on it.
//
// Two neighbours of this check live in verify.html itself: loading every
// script into one scope fails on two files declaring one top-level name, and
// the Compile test looks up every file-prefixed function page.js calls. That
// every dispatched kernel is generated is verify_frame.js, and that the page
// refreshes for every case is verify_page.js.

// verify.html loads it, then runs the body it registers.
verifyCheck('check_gpu_shader.js', function (process) {
'use strict';

const BUILTINS = new Set([
    'sin', 'cos', 'tan', 'abs', 'max', 'min', 'sqrt', 'exp', 'log', 'pow', 'floor', 'ceil',
    'clamp', 'select', 'mix', 'sign', 'fract', 'dot', 'length', 'normalize', 'step',
    'distance', 'smoothstep', 'round', 'trunc',
    'f32', 'u32', 'i32', 'bool', 'vec2f', 'vec3f', 'vec4f', 'vec2u', 'vec3u', 'vec4u',
    'vec2', 'vec3', 'vec4', 'array', 'atomicAdd', 'atomicLoad', 'atomicStore',
    'textureStore', 'textureLoad', 'textureDimensions', 'atan', 'atan2',
    'atomicMax', 'atomicMin', 'atomicExchange', 'bitcast',
    'vec2i', 'vec3i', 'vec4i', 'vec2h', 'mat2x2f', 'mat3x3f', 'mat4x4f',
    'if', 'for', 'while', 'switch', 'return', 'let', 'var', 'fn', 'struct', 'case',
    'workgroup_size', 'compute', 'builtin', 'group', 'binding', 'storage',
]);

let failures = 0;
const fail = (message) => { console.log(`  FAIL  ${message}`); failures++; };

// WGSL reserved words
//
// WGSL reserves a long list of identifiers for future use, and using one as a
// name is a parse error. `layout` is on the list. The emitters are JavaScript
// template strings, so nothing else in Run checks would see one.
const WGSL_RESERVED = new Set(`
NULL Self abstract active alignas alignof as asm asm_fragment async attribute auto await
become binding_array cast catch class co_await co_return co_yield coherent column_major
common compile compile_fragment concept const_cast consteval constexpr constinit crate
debugger decltype delete demote demote_to_helper do dynamic_cast enum explicit export
extends extern external fallthrough filter final finally friend from fxgroup get goto
groupshared highp impl implements import inline instanceof interface layout lowp macro
macro_rules match mediump meta mod module move mut mutable namespace new nil noexcept
noinline nointerpolation non_coherent noncoherent noperspective null nullptr of operator
package packoffset partition pass patch pixelfragment precise precision premerge priv
protected pub public readonly ref regardless register reinterpret_cast require resource
restrict self set shared sizeof smooth snorm static static_assert static_cast std
subroutine super target template this thread_local throw trait try type typedef typeid
typename typeof union unless unorm unsafe unsized use using varying virtual volatile
wgsl where while writeonly yield
`.trim().split(/\s+/));

// One source, all checks
const POINT_LOCAL_NAMES = ['column', 'row', 'level', 'p', 'spacing', 'timeStep', 'i', 'j', 'a', 'b', 'h', 'dt'];

function staticCheck(label, source, entryPoints, options = {}) {
    if (!options.quiet) {
        console.log('');
        console.log(`STATIC CHECK: ${label}`);
        console.log(`  ${source.split('\n').length} lines, ${source.length} characters`);
    }

    for (const [open, close] of [['{', '}'], ['(', ')'], ['[', ']']]) {
        let depth = 0, bad = false;
        for (const ch of source) {
            if (ch === open) depth++;
            else if (ch === close) depth--;
            if (depth < 0) bad = true;
        }
        if (bad || depth !== 0) fail(`${label}: unbalanced ${open} ${close}, final depth ${depth}`);
    }

    // Two definitions of one name is a redeclaration error, and generating
    // names from a field list makes it easy: the dictionary emits relax_<field>
    // for every equation, so an entry point of the same name breaks the module.
    const defined = new Set();
    const duplicated = new Set();
    for (const match of source.matchAll(/\bfn\s+([A-Za-z_]\w*)\s*\(/g)) {
        if (defined.has(match[1])) duplicated.add(match[1]);
        defined.add(match[1]);
    }
    for (const name of duplicated) fail(`${label}: fn ${name} is defined more than once`);
    // A struct declaration defines its constructor, Layout(...).
    for (const match of source.matchAll(/\bstruct\s+([A-Za-z_]\w*)/g)) defined.add(match[1]);

    // The boundary type arrays are i32, so a switch over one with u-suffixed
    // case selectors is a type error. It is easy to write, since every other
    // integer in these shaders is u32.
    const sourceLines = source.split('\n');
    sourceLines.forEach((line, index) => {
        if (!/\bswitch\b/.test(line)) return;
        if (!/grid\.type(Center|XFace|YFace)|\bkind\b|\bboundaryType\b/.test(line)) return;
        for (let k = index + 1; k < Math.min(index + 20, sourceLines.length); k++) {
            if (/^\s*\}\s*$/.test(sourceLines[k])) break;
            if (/case\s+\d+u\b/.test(sourceLines[k])) {
                fail(`${label}: line ${k + 1} switches on a boundary type with a u-suffixed ` +
                     'case selector; the type arrays are i32');
            }
        }
    });

    // Comments contain things like "through (the wall)" that look like calls,
    // so they are stripped before looking for identifiers.
    const code = source.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

    const called = new Map();
    for (const match of code.matchAll(/([A-Za-z_]\w*)\s*\(/g)) {
        const name = match[1];
        if (BUILTINS.has(name) || defined.has(name)) continue;
        called.set(name, (called.get(name) || 0) + 1);
    }
    for (const [name, count] of called) fail(`${label}: calls ${name}() ${count}x but nothing defines it`);

    // A value that never became WGSL: a JavaScript undefined, NaN or object
    // pasted into a template.
    for (const suspicious of ['undefined', 'NaN', '[object']) {
        if (code.includes(suspicious)) {
            fail(`${label}: contains "${suspicious}", which is almost certainly an unsubstituted value`);
        }
    }

    // Declared names: variables, function names, parameters, struct members.
    const declared = new Set();
    for (const m of code.matchAll(/\b(?:var|let|const)\s*(?:<[^>]*>)?\s*([A-Za-z_]\w*)/g)) declared.add(m[1]);
    for (const m of code.matchAll(/\bfn\s+([A-Za-z_]\w*)/g)) declared.add(m[1]);
    for (const m of code.matchAll(/\bstruct\s+([A-Za-z_]\w*)/g)) declared.add(m[1]);
    // fn params and struct members both read `name : Type`
    for (const m of code.matchAll(/([A-Za-z_]\w*)\s*:\s*(?:ptr<|array<|vec|f32|u32|i32|bool|[A-Z])/g)) declared.add(m[1]);

    let reserved = 0;
    for (const name of declared) {
        if (WGSL_RESERVED.has(name)) {
            fail(`${label}: "${name}" is a WGSL reserved keyword and cannot be an identifier`);
            reserved++;
        }
    }

    for (const entry of entryPoints) {
        if (!defined.has(entry)) fail(`${label}: entry point ${entry} is missing`);
    }

    // The point names are local to every function that uses them, and a
    // fragment one emitter pastes into another's function has to find them
    // defined there. Run checks compiles no WGSL, so an undefined local would
    // otherwise be found only by the Compile test.
    let undefinedLocals = 0;
    for (const m of code.matchAll(/\bfn\s+(\w+)\s*\(([^{]*)\{/g)) {
        let depth = 1, k = m.index + m[0].length;
        while (depth && k < code.length) { if (code[k] === '{') depth++; else if (code[k] === '}') depth--; k++; }
        const body = code.slice(m.index + m[0].length, k);
        for (const name of POINT_LOCAL_NAMES) {
            if (!new RegExp(`(?<![.\\w])${name}(?!\\w)`).test(body)) continue;
            if (new RegExp(`(?<!\\w)${name}\\s*:`).test(m[2])) continue;
            if (new RegExp(`\\b(?:let|var)\\s+${name}\\b`).test(body)) continue;
            fail(`${label}: fn ${m[1]} reads ${name} and does not define it`);
            undefinedLocals++;
        }
    }

    if (!options.quiet) {
        console.log(`  ${defined.size} functions defined, ${called.size} unresolved, ` +
                    `${declared.size} identifiers, ${reserved} reserved, ${undefinedLocals} undefined point locals`);
    }
}

// The app's source
//
// Every emitter, the generated kernels and the draw shader, assembled as
// runtime.js assembles them, which is what the browser compiles.
const appPlate = new Plate(3);
appGeometry(appPlate);

staticCheck('app', buildSimulationSource(appPlate, appSystem(), appBoundaryTable(), 8, appActivePreset().display),
    ['drawField', 'setLevel0', 'computeDivergence', 'recordVelocityMax', 'scanVelocityMax']);

// Every preset, not only the one the page opens on: a term that fails to emit,
// emits a bare integer, or calls something never written would otherwise wait
// for a viewer to click that case. One line per preset, since the output that
// matters is a failure.
console.log('');
console.log('EVERY PRESET ASSEMBLES');
{
    const opened = appActivePreset().id;
    let widest = 0;
    // Every coefficient slot any preset reads, so a slot missing from the list
    // is caught here and not as a shader compile error.
    const slotsUsed = new Set();
    for (const preset of casePresets()) {
        appSelectPreset(preset.id);
        const presetPlate = new Plate(3);
        appGeometry(presetPlate);
        const source = buildSimulationSource(presetPlate, appSystem(), appBoundaryTable(), 8, appActivePreset().display);
        widest = Math.max(widest, source.length);
        for (const match of source.matchAll(/\bcoefficients\.(\w+)/g)) slotsUsed.add(match[1]);
        // The divergence is computed wherever there is a velocity to take it of.
        staticCheck(`preset ${preset.id}`, source,
            ['drawField', 'setLevel0', ...(kernelsHasVelocity(appSystem()) ? ['computeDivergence'] : [])],
            { quiet: true });
    }
    appSelectPreset(opened);

    const declared = new Plate(3).coefficientSlotNames;
    if (slotsUsed.size === 0) {
        fail('no preset reads a coefficient slot; the sliders would be writing a buffer nobody reads');
    }
    for (const name of slotsUsed) {
        if (!declared.includes(name)) fail(`a preset reads coefficients.${name}, which is not a slot`);
    }

    console.log(`  ${casePresets().length} presets assembled, largest ` +
        `${widest} characters, all checked for unresolved calls, reserved words and`);
    console.log('  integer literals where a float is required.');
    console.log(`  ${slotsUsed.size} of ${declared.length} coefficient slots read: ` +
        `${[...slotsUsed].sort().join(', ')}`);
}

console.log(failures === 0
    ? '  No static problems found.'
    : `  ${failures} problem(s). Fix before running the GPU checks on verify.html.`);
process.exitCode = failures === 0 ? 0 : 1;
});
