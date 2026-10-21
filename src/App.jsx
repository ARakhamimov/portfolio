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
            description: "A free, open-source browser tool, built as my Master's project at The Cooper Union, that simulates reactive flows in real time for teaching. A multigrid solver in WebGPU carries momentum, heat and species transport with reactions, and hatching over the colors keeps every view readable with color-vision deficiency. Preset cases, live sliders and image and video export are built in.",
            href: "/Vizier/index.html",
            label: "Go",
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
