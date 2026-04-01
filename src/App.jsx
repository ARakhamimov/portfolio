import React from 'react'
import '@mantine/core/styles.css';

import { MantineProvider } from '@mantine/core';
import Header from "./components/Header.jsx"
import Body from "./components/Body.jsx";
import Footer from "./components/Footer.jsx"

const App = () => {
    const deck_info = [
        {
            imagesrc: "gifs/multigrid_heat_transfer.gif",
            title: "Multigrid Heat Equation",
            field: "Transport Phenomena",
            description: "Solve the 2D steady state heat equation with complex boundary conditions. Compare Gauss-Seidel iteration to Multigrid methods. Implemented with WebGPU!",
        },
        {
            imagesrc: "gifs/reaction_diffusion.gif",
            title: "Reaction Diffusion Equation",
            field: "Transport Phenomena",
            description: "A reaction-diffusion system is simulated with Gauss-Seidel for diffusion and forward Euler for reaction. Complex boundary conditions can be used and boundary conditions can change mid-simulation. Implemented with WebGPU!",
        }
    ]
    return (
        <MantineProvider>
            <div className="flex flex-col">
                {/*Sticky Header Element*/}
                <div id="Home"/>
                <Header/>

                {/*Main Body*/}
                <Body key="body" deck={deck_info}/>

                {/*Footer About Me Element*/}
                <div id="About_Me"/>
                <Footer/>

            </div>
        </MantineProvider>
    )
}

export default App
