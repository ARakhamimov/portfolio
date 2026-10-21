import React from 'react'

const Footer = () => {
    return (
        <div className="bg-zinc-50 shadow-red-400 shadow-[0px_-2px_2px_0px] flex flex-col md:flex-row items-center justify-evenly gap-8 p-8 md:p-16">
            <img src="/images/website_photo.jpg" alt={"photo of me"} className="w-48 md:w-1/5 aspect-square object-cover shadow-lg shadow-red-200 rounded-4xl"></img>
            <h2 className="text-center font-serif font-bold text-lg md:text-2xl w-full md:w-3/5">
                I am a currently a chemical engineering masters student at
                <a href="https://cooper.edu" target="_blank" className=" text-red-600"> The Cooper Union </a>
                where I also got my B.E. in ChE with a minor in mathematics.
                <br/><br/>
                This website serves to host some of my projects, thanks for checking it out 😊.
                <br/>
                You can contact me at <b className="text-red-600 break-words">allen.rakhamimov@cooper.edu</b>
                <br/><br/><br/>
                <a href="#Home" className="text-red-900 font-mono opacity-30 text-xl md:text-3xl animate-rainbow">↑ BACK TO TOP OF PAGE ↑</a>
            </h2>
        </div>
    )
}
export default Footer
