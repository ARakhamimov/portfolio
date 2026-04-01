import React from 'react'

import Card from "./Card.jsx"

const Body = ({ deck }) => {
    return (
        <div className="flex-grow bg-red-50">
            <h1 className="text-3xl py-16 font-mono font-bold text-center">
            Hello, I'm <b className="text-red-500">Allen</b>! Check out some of my projects below! <br/>
            This website is currently a work-in-progress (W.I.P.) 😊.
            </h1>

            <h1 className="text-6xl text-red-600 py-8 font-bold text-center underline">
            Projects
            </h1>
            <div className="flex justify-evenly content-evenly flex-wrap">
                {deck.map((projectInfo) => (
                    <Card key={projectInfo.title} {...projectInfo} />
                ))}
            </div>


        </div>
    )
}
export default Body
