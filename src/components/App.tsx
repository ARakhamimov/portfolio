import { useState } from 'react';

import '.././styles/index.css'

import multigridHeatTransferGif from "../assets/multigrid_heat_transfer.gif"
import reactionDiffusionGif from "../assets/reaction_diffusion.gif"

import Card from "./Card.tsx";
import NavBar from "./NavBar.tsx";

function App() {
    const [page, setPage] = useState("home");

    const deck_info = [
        {
            image: multigridHeatTransferGif,
            title: "Multigrid Heat Equation",
            field: "Transport Phenomena",
            description: "Solve the 2D steady state heat equation with complex boundary conditions. Compare Gauss-Seidel iteration to Multigrid methods. Implemented with WebGPU!",
            func: () => {setPage("heat")},
        },
        {
            image: reactionDiffusionGif,
            title: "[W.I.P] Reaction Diffusion Equation",
            field: "Transport Phenomena",
            description: "A reaction-diffusion system is simulated with Gauss-Seidel for diffusion and forward Euler for reaction. Complex boundary conditions can be used and boundary conditions can change mid-simulation. Implemented with WebGPU!",
            func: () => {setPage("scalar")},
        }
    ]

    const goHome = () => {setPage("home")};

    if (page == "heat") {
        return (
            <>
                <NavBar goHome={goHome}/>
                <h1>Editing the website! There'll be stuff here soon[-ish]!</h1>
            </>
        )
    }

    if (page == "scalar") {
        return (
            <>
                <NavBar goHome={goHome}/>
                <h1>Editing the website! There'll be stuff here soon[-ish but probably after the heat equation one]!</h1>
            </>
        )
    }

    return (
    <>
        <NavBar goHome={goHome}/>

        <div className="about_me">
            <h2>I am a chemical engineering student at The Cooper Union. Check out some of the projects below :). <br/> This website will probably look nicer the further into the future we are from when I'm writing this sentence.</h2>
        </div>
        <h1 id="Projects">Projects</h1>
        <div className="deck">
            {deck_info.map((projectInfo) => (
                <Card key={projectInfo.title} {...projectInfo} />
            ))}
        </div>
        {/*<h1 id="About">About</h1>*/}
        {/*<div className="deck">*/}

        {/*</div>*/}
    </>
    )
}

export default App
