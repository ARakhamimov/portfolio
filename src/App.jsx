import React from 'react'
import '@mantine/core/styles.css';

import { MantineProvider } from '@mantine/core';
import Header from "./components/Header.jsx"
import Body from "./components/Body.jsx";
import Footer from "./components/Footer.jsx"

const App = () => {
    // `href` is optional. A card without one renders a disabled button, so a
    // placeholder reads as unfinished rather than as broken.
    const deck_info = [
        {
            imagesrc: "/gifs/vizier.gif",
            title: "Vizier: WebGPU Reactive Flow Simulation",
            field: "Master's Project — Chemical Engineering",
            description: "Produced as the work product of my Master's at The Cooper Union, this is a free, open-source, browser-based tool for real-time simulation and visualization of reactive flows for educational visualization. Solves PDEs using multigrid methods implemented in WebGPU. Implements momentum, heat, and species transfer with a reaction term. CVD-accessible coloring shows hatching on top of colors for added visual context. Sliders and buttons for changing views, simulation parameters, and saving images and videos. Comes with several pre-set cases for common interesting flows.",
            href: "/vizier/",
            label: "Open the demo",
        },
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
