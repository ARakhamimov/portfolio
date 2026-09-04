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
            description: "A browser tool for teaching transport phenomena: momentum, heat and chemical species solved together on a staggered grid with multigrid, fast enough to watch a flow develop while you change it. Adding an equation is a specification rather than new solver code, and every approximation the tool makes is reported on screen instead of hidden.",
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
