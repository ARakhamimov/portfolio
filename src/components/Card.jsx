import React from 'react'
import StartButton from "./StartButton.jsx";

const Card = (props) => {
    return (
        <div className="border-2 border-red-600 rounded-2xl w-48/100 h-2/3 my-16 xl:flex-nowrap flex-wrap bg-zinc-50 flex p-8 justify-around shadow-2xl ">
            <img
                src={props.imagesrc}
                alt={"image (sorry for no description)"}
                className=" w-1/3 h-1/3 aspect-square m-4 content-center shadow-lg shadow-red-200 rounded-4xl"
            ></img>
            <div className="flex flex-col justify-start text-center content-center h-auto p-4 ">
                <h2 className=" font-serif text-red-600 font-bold text-2xl mt-4"> {props.title} </h2>
                <h2 className=" font-mono text-red-800 font-bold text-xl mb-4"> {props.field} </h2>
                <h2 className=" text-lg mb-auto">
                    {props.description}
                </h2>
                <StartButton/>
            </div>
        </div>
    )
}
export default Card
