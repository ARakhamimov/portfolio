# Reading this folder

Vizier is a browser-based simulator for reactive flows. It has one
general-purpose solver, and each case hands that solver its equations as a list
of terms. A term is looked up in a dictionary of discretized PDE terms, and the
dictionary entry is the WGSL the GPU runs. Adding a species, a term or a whole
equation system is an edit to a case and to that dictionary, and the solver
itself does not change.

There is no build step. The page loads plain scripts in the order given in
`scripts/manifest.js`, so what runs in the browser is what is on disk.

This file is a map: what is solved, how one frame runs, what each file owns, and
the naming rules. The reasoning behind the numerical methods is in the thesis
the tool was written for.

## What is solved

Each case declares an equation system, and the solver advances it in time with
the theta method, solving each step with multigrid V-cycles. The fluid cases
solve incompressible flow with heat and species transport:

```
du/dt + (u . grad) u  =  nu lap u  -  grad p  (+ forces)
               div u  =  0
dT/dt + (u . grad) T  =  alpha lap T  +  heat of reaction
dc/dt + (u . grad) c  =  D lap c  +  rate law
```

Other cases solve conduction alone, two or three reacting species with no flow,
a porous bed, electrostatics and magnetostatics, a conducting fluid, the
telegraph equations, and Schrodinger's equation. Each physics is one builder in
`physics.js`, chosen by the case's `system.physics`.

Scalars live at cell centers and velocities on the faces between them (a
staggered grid). The pressure row is the divergence constraint, and its
diagonal in pressure is exactly zero; it is relaxed by its own step (Schur
relaxation, in `system.js`) while every other row is relaxed point by point.

## One frame, end to end

```
page.js         start: get a GPU device, then buildScene for the chosen case
runtime.js      buildSimulationSource assembles the WGSL for the case's system;
                one pipeline per entry point; buffers allocated and uploaded
page.js         each animation frame, tick calls CycleRunner.frame
runtime.js      frame -> advanceOneTimeStep -> vCycle, a fixed number of
                cycles per step with no convergence check
multigrid.js    vCycle: smooth, computeResiduals, restrictToCoarser,
                fillBoundaries, rememberCoarseSolution,
                buildCoarseRightHandSide on the way down; computeCoarseChange,
                addCoarseChangeToFiner, smooth on the way up
kernels.js      the entry points those calls dispatch
draw.js         one dispatch over the canvas, one invocation per pixel
page.js         on every change, and once a second with fresh telemetry,
                refresh redraws the button bar and legend (controls.js) and
                the panel (equationPanel.js, casePanel.js)
```

## The files

Each folder is a layer, and a file calls only its own layer and the ones above
it in this list.

`scripts/solver/` writes the solver's WGSL, and the layout it is written
against:

| file | what it owns |
|---|---|
| `wgslLiterals.js` | Numbers and colors written as WGSL text. |
| `grid.js` | Staggered storage: the mesh sizes, the locations, the `Plate` and its indexing, the controls buffer (`CONTROLS_MEMBERS`), and the WGSL structs and index functions. |
| `fields.js` | The fields Vizier can solve (`FIELD_SPEC`) and the arrays each is given. |
| `geometry.js` | Boundary types, shapes, and how a shape marks the points it covers. |
| `boundary.js` | The boundary table, keyed on (type, role, field), the ports, and the ghost fill. |
| `coefficients.js` | The constants a case declares (`COEFFICIENT_CONSTANTS`), the slots a term reads them through, and the four forms a coefficient takes. |
| `multigrid.js` | Restriction, prolongation, the Full Approximation Scheme's two steps, and the order of a V-cycle. |
| `operators.js` | Divergence, vorticity and the averages between storage locations. |
| `terms.js` | The dictionary of terms (`TERM_DICTIONARY`), each a value and a diagonal written as WGSL, with how the panel writes it. |
| `equations.js` | An equation as a case declares it, and one row's WGSL under the theta method. |
| `system.js` | Several equations solved together, and the Schur step for a constraint row. |
| `kernels.js` | The compute entry points, generated from the system. |
| `monitors.js` | What the page watches while a case runs: field health, peak speed, wall heat flux, divergence. |

`scripts/display/` is the picture:

| file | what it owns |
|---|---|
| `display.js` | Every color and threshold the draw shader and the legends read, and how a number is written on the page. |
| `views.js` | One record per view (`VIEWS`): its name, what it needs the system to solve, and its legend. |
| `draw.js` | The draw shader, one arm per view, and what species, materials and overlays a system can show. |
| `legend.js` | How a legend is laid out: the color key, the hatch key and the overlay notes. |

`scripts/` holds the host side, with the cases in `scripts/cases/`:

| file | what it owns |
|---|---|
| `manifest.js` | The load order, and the case list grouped as the case box shows it (`CASE_CATEGORIES`). |
| `cases.js` | What a case may declare (`caseDefaults`), the presets the cases expand into, what a slider moves, and a case's geometry and ports. |
| `physics.js` | One builder per physics: the equations, the boundary table and the starting state. |
| `cases/profiles.js` | The profiles, weights, layers and seeds a case file is written with. |
| `cases/` | One file per case. Add a case here and list it under its heading in `manifest.js`. |
| `sandbox.js` | What the sandbox refuses, and what its editor does to a layout. |
| `app.js` | Which case is showing, the viewer's slider values and layout, and the cycle budget. |
| `runtime.js` | Shader assembly, pipelines, buffers, and `CycleRunner`, which issues a frame's dispatches. |

`scripts/page/` is the page:

| file | what it owns |
|---|---|
| `pageElements.js` | The page's building blocks: an element, a button, a row, a group, a slider row. |
| `diagnostics.js` | Reading state back off the GPU: the run export, saving files, simulated color vision. |
| `controls.js` | The keyboard map, the sliders, the button bar and the legend. |
| `editor.js` | The sandbox's Build card and build mode. |
| `equationPanel.js` | The equations and reactions set from the case, and the symbols they are set in. |
| `casePanel.js` | The case's numbers (`caseSummary`) and the tables beside the picture. |
| `capture.js` | Saving the canvas as an image or a video. |
| `page.js` | The page: opening the GPU, building a scene, the case box, the frame loop, the refresh and the divergence watchdog. |

`index.html` is the page's markup, and `page.js` runs it: `start()` lists the
steps, and each is a function below it. `verify.html` runs the checks in
`verify/` in a browser; `verify/checks.js` lists them.

## Reading order

| | file | what to read |
|---|---|---|
| 1 | `cases.js`, `cases/` | `caseDefaults`, then one case file. |
| 2 | `physics.js` | `physicsSystem`, then the builder for that case's physics. |
| 3 | `solver/terms.js` | The `timeDerivative`, `diffusion` and `advection` entries, then `makeEquationCode` in `equations.js`. |
| 4 | `runtime.js`, `solver/multigrid.js` | `CycleRunner.frame` and `vCycle`. |
| 5 | `solver/grid.js` | The point offsets and the `Plate`'s index helpers. |
| 6 | the rest of `solver/` | Only as a question comes up. |

`scripts/display/` and `scripts/page/` are never on the solver's path.

## Naming

A name that fixes a storage location says which: `widthCenter`, `indexXFace`,
`typeYFace`. A wrong location gives a silent half-cell offset and not a visible
failure. Code that works at any location takes `location` as a parameter.

A point's indices are `column` and `row` at every location, rows counting down
the screen, so `above` is `row - 1` and a positive y velocity points down. `p`
is the flat array index of the point being worked on. Grid levels are levels,
with 0 the finest; a cycle is only ever the multigrid cycle.

Most functions another file calls start with their file's name (`drawMaterials`
in `draw.js`, `physicsSystem` in `physics.js`, `panel` for both panels); a
generator of WGSL is named for what it writes (`makeEquationCode`). The
scripts are classic scripts sharing one lexical scope, so every file reads
another's names directly, and a top-level name is declared once in the whole
tree: a second `const` of the same name is a syntax error that discards the
whole file.
