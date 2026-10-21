import React from 'react'
import StartButton from "./StartButton.jsx";

// Picture beside the text from tablet width up, above it on a phone so it
// never shrinks to a thumbnail. One card a row, capped at a reading width,
// until the screen fits two (2xl), then half the row less half the gap.
const Card = (props) => {
    return (
        <div className="flex flex-col md:flex-row md:items-center gap-6 w-full max-w-5xl 2xl:max-w-none 2xl:w-[calc(50%-1rem)] border-2 border-red-600 rounded-2xl bg-zinc-50 p-4 sm:p-8 shadow-2xl">
            <img
                src={props.imagesrc}
                alt={props.title}
                className="w-full max-w-md mx-auto md:mx-0 md:w-2/5 md:max-w-none md:shrink-0 aspect-square object-cover shadow-lg shadow-red-200 rounded-4xl"
            ></img>
            <div className="flex flex-col md:flex-1 text-center">
                <h2 className="font-serif text-red-600 font-bold text-xl sm:text-2xl"> {props.title} </h2>
                <h2 className="font-mono text-red-800 font-bold text-base sm:text-xl mb-4"> {props.field} </h2>
                <p className="text-base sm:text-lg text-left mb-6 flex-grow">
                    {props.description}
                </p>
                <StartButton href={props.href} label={props.label}/>
            </div>
        </div>
    )
}
export default Card
