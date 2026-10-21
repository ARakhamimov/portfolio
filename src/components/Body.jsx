import React from 'react'

import Card from "./Card.jsx"

// The cards wrap two to a row on a wide screen (2xl) and one below it. A row
// that is not full is centered, so a lone card does not sit in the left column.
const Body = ({ deck }) => {
    return (
        <div className="flex-grow bg-red-50 pb-16">
            <h1 className="text-xl sm:text-3xl px-4 py-8 sm:py-16 font-mono font-bold text-center">
            Hello, I'm <b className="text-red-500">Allen</b>! Check out some of my projects below! <br/>
            This website is perpetually a work-in-progress 😊
            </h1>

            <h1 className="text-4xl sm:text-6xl text-red-600 py-4 sm:py-8 font-bold text-center underline">
            Projects
            </h1>
            <div className="flex flex-wrap justify-center gap-8 max-w-[1840px] mx-auto px-4 sm:px-8 pt-8">
                {deck.map((projectInfo) => (
                    <Card key={projectInfo.title} {...projectInfo} />
                ))}
            </div>


        </div>
    )
}
export default Body
