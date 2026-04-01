import React from 'react'

const Footer = () => {
    return (
        <div className="bg-zinc-50 shadow-red-400 shadow-[0px_-2px_2px_0px] flex justify-evenly ">
            <img src="/images/website_photo.jpg" alt={"photo of me"} className="w-1/5 h-auto m-16 content-center shadow-lg shadow-red-200 rounded-4xl "></img>
            <h2 className="text-center font-serif font-bold text-2xl content-center w-3/5">
                I am a currently a senior chemical engineering student at
                <a href="https://cooper.edu" target="_blank" className=" text-red-600"> The Cooper Union </a>
                pursuing a combined Masters & Bachelors of Engineering with a minor in mathematics.
                <br/><br/>
                This website serves to host some of my projects, thanks for checking it out 😊.
                <br/>
                You can contact me at <b className="text-red-600">allen.rakhamimov@cooper.edu</b>
                <br/><br/><br/>
                <a href="#Home" className="text-red-900 font-mono opacity-30 text-3xl animate-rainbow">↑ BACK TO TOP OF PAGE ↑</a>
            </h2>
        </div>
    )
}
export default Footer
