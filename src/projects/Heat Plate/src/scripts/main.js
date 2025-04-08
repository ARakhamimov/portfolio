let FPS;
let GAUSS_SEIDEL_SUBSTEPS; // times to project per frame
let hasBGRA8unormStorage; // canvas format variable

const SLOMO = false;

if (SLOMO) {
    FPS = 5;
    GAUSS_SEIDEL_SUBSTEPS = 1;
} else {
    FPS = 60;
    GAUSS_SEIDEL_SUBSTEPS = 40; 
} 

const V_CYCLE_SMOOTH_STEPS = 5;

const DRAW = true;

const maxTemperature = 100;
const RESIDUAL_MULTIPLIER = 10;
const coldThreshold = 0.03;

let PAUSED = false;
let LOOP_CYCLE = false;
let SMOOTHEN_RESIDUAL = false;
let SMOOTHEN_TEMPERATURE = false;
let V_CYCLE = false;
let FMG_CYCLE = false;
let F_CYCLE = false;
let GAUSS_SEIDEL = false;
let COMPUTE_RESIDUAL = false;
let DISPLAY_RESIDUAL = false;

let V_CYCLE_COUNTER = 0;
let GAUSS_SEIDEL_COUNTER = 0;
let CELL_WORK_COUNTER = 0;

const UPDATE_INTERVAL = 1000 / FPS; // milliseconds inbetween frames
const TIMESTEP = 1 / 60; // seconds "dt" (framerate independent)

const canvas = document.getElementById('plate'); // Define canvas
const WORKGROUP_SIZE = 8; // don't change this unless you have a good reason