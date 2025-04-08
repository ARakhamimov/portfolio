// This file will contain all the initializations w.r.t. the storage arrays

const INTERIOR = 1;
const DIRICHLET = 2;
// const NEUMANN = 3;

const views = ['Temperature', 'Residual', 'Red Black', 'Ordering']
const TOTAL_VIEWS = views.length;

const stages = [1024, 512, 256, 128, 64, 32, 16, 8, 4];

const leftEdgeTemperature = 100;
const rightEdgeTemperature = 0;
const topEdgeTemperature = 0;
const bottomEdgeTemperature = 0;

class Plate { // Assumed square
    constructor(finestStage) {
        this.finestStage = Math.max(0, Math.min(Math.round(finestStage), stages.length - 1)); // Pedantic but okay
        
        this.widths = new Uint32Array(stages.slice(finestStage));
        this.cells = new Uint32Array(stages.slice(finestStage).map((x) => x * x));
        this.offsets = new Uint32Array(this.computeOffsets());
        this.spacings = new Float32Array(stages.slice(finestStage).map((x) => 1 / x.toFixed(1)));

        this.coarsestStage = this.widths.length - 1;
        
        this.numResolutions = this.widths.length;
        this.totalCells = this.offsets[this.offsets.length - 1];

        this.boundary = new Int32Array(this.totalCells);
        this.boundary.fill(INTERIOR);

        this.temperature = new Float32Array(this.totalCells);
        this.residual = new Float32Array(this.totalCells);
        
        this.arrayBytes = this.numResolutions * 4;
        this.gridBytes = this.totalCells * 4;

        this.computeStage = new Uint32Array([0]);
        this.viewStage = new Uint32Array([0]);
        this.viewMode = new Uint32Array([0]);
    }

    plateInfo() {
        console.log(`Grid Resolution: ${stages[this.finestStage]}.`);
        console.log(`Total Cells: ${this.totalCells}.`);
        console.log(`Widths: ${this.widths}`);
        console.log(`Cells: ${this.cells}`);
        console.log(`Offsets: ${this.offsets}`);
        console.log(`Spacings: ${this.spacings}`);
    }

    computeOffsets() {
        let offsets = [0];
        let sum = 0;
        
        this.cells.map((x)=>{
            sum += x; offsets.push(sum);
            });

        return offsets;
    }

    computeTotalCells() {
        let numCells = this.widths.map((x) => x * x);
        let sum = 0;
        
        numCells.map((x)=>{sum += sum + x});

        return sum;
    }

    enforceBoundaryCondition() {
        for(let r = 0; r < this.numResolutions; r++) {
            
            let currentWidth = this.widths[r];
            let currentOffset = this.offsets[r];
            
            for (let i = 0; i < currentWidth; i++) {

                let iOnLeft = i == 0;
                let iOnRight = i == currentWidth - 1;
                let iOnBorder = (iOnLeft || iOnRight);
                
                for (let j = 0; j < currentWidth; j++) {

                    let jOnTop = j == 0;
                    let jOnBottom = j == currentWidth - 1;
                    let jOnBorder =  (jOnTop || jOnBottom);
                    
                    if (!iOnBorder && !jOnBorder) {
                        continue;
                    }
        
                    let currentIndex = currentOffset + i + j * currentWidth;
                    this.boundary[currentIndex] = DIRICHLET;
    
                    if (iOnLeft && jOnTop) {
                        this.temperature[currentIndex] = 0.5 * (leftEdgeTemperature + topEdgeTemperature);
                    } else if (iOnLeft && jOnBottom) {
                        this.temperature[currentIndex] = 0.5 * (leftEdgeTemperature + bottomEdgeTemperature);
                    } else if (iOnRight && jOnTop) {
                        this.temperature[currentIndex] = 0.5 * (rightEdgeTemperature + topEdgeTemperature);
                    } else if (iOnRight && jOnBottom) {
                        this.temperature[currentIndex] = 0.5 * (rightEdgeTemperature + bottomEdgeTemperature);
                    } else if (iOnLeft) {
                        this.temperature[currentIndex] = leftEdgeTemperature;
                    } else if (jOnTop) {
                        this.temperature[currentIndex] = topEdgeTemperature;
                    } else if (iOnRight) {
                        this.temperature[currentIndex] = rightEdgeTemperature;
                    } else {
                        this.temperature[currentIndex] = bottomEdgeTemperature;
                    }
                }
            }
        }
    }

    setRedBlack() {
        for(let r = 0; r < this.numResolutions; r++) {
            
            let currentWidth = this.widths[r];
            let currentOffset = this.offsets[r];

            for (let i = 0; i < currentWidth; i++) {

                let iParity = i % 2;

                for (let j = 0; j < currentWidth; j++) {

                    let jParity = j % 2;

                    if (iParity != jParity) {
                        continue;
                    } 

                    this.boundary[currentOffset + i + j * currentWidth] *= -1;
                }
            }
        }
    }

    enforceCircleCondition(normalizedCenterX, normalizedCenterY, normalizedRadius, condition) {
        for(let r = 0; r < this.numResolutions; r++) {

            let currentWidth = this.widths[r];
            let currentOffset = this.offsets[r];
            let currentSpacing = this.spacings[r];

            for (let i = 0; i < currentWidth; i++) {

                let screenSpacePositionX = currentSpacing * (i + 0.5);
                let distanceX = normalizedCenterX - screenSpacePositionX;

                for (let j = 0; j < currentWidth; j++) {

                    let screenSpacePositionY = currentSpacing * (j + 0.5);
                    let distanceY = normalizedCenterY - screenSpacePositionY;  
                    let distance = Math.sqrt(distanceX ** 2 + distanceY ** 2);
                    
                    if (distance <= normalizedRadius) {

                        let currentIndex = currentOffset + i + j * currentWidth;
                        this.boundary[currentIndex] = DIRICHLET;
                        this.temperature[currentIndex] = condition;

                    }
                }
            }
        }
    }

    logViewStage() {
        console.log(`Grid Stage: ${this.viewStage[0]} / ${this.coarsestStage}.`)
    }

    logViewMode() {
        console.log(`Mode: ${views[this.viewMode[0]]}.`)
    }

    decrementComputeStage() {
        this.computeStage[0] = Math.max(0, Math.min(this.computeStage[0] - 1, this.widths.length - 1));
    }

    incrementComputeStage() {
        this.computeStage[0] = Math.max(0, Math.min(this.computeStage[0] + 1, this.widths.length - 1));
    }

    decrementViewMode() {
        this.viewMode[0] = Math.max(0, Math.min(this.viewMode[0] - 1, TOTAL_VIEWS - 1));
        this.logViewMode();
    }

    incrementViewMode() {
        this.viewMode[0] = Math.max(0, Math.min(this.viewMode[0] + 1, TOTAL_VIEWS - 1));
        this.logViewMode();
    }

    decrementViewStage() {
        this.viewStage[0] = Math.max(0, Math.min(this.viewStage[0] - 1, this.widths.length - 1));
        this.logViewStage();
    }

    incrementViewStage() {
        this.viewStage[0] = Math.max(0, Math.min(this.viewStage[0] + 1, this.widths.length - 1));
        this.logViewStage();
    }
}

const plate = new Plate(2);
plate.enforceBoundaryCondition();

plate.enforceCircleCondition(0, 0.5, 0.1, 100);
plate.enforceCircleCondition(0.5, 1, 0.1, 100);
plate.enforceCircleCondition(0.5, 0, 0.1, 100);
plate.enforceCircleCondition(1, 0.5, 0.1, 0);

plate.enforceCircleCondition(0.3, 0.5, 0.1, 0);
plate.enforceCircleCondition(0.7, 0.5, 0.1, 0);

plate.setRedBlack();