import React from "react";

export default function Header() {
  return (
      <div className="bg-zinc-50 shadow-sm shadow-red-400 flex flex-wrap items-center justify-between gap-x-6 sticky top-0 z-50 px-4 sm:px-12 py-3 sm:py-6">
        <h1 className="text-xl sm:text-4xl text-red-600 hover:text-red-800 font-serif font-bold">
            <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" target="_blank"> Allen Rakhamimov</a>
        </h1>
        <div className="flex gap-4 sm:gap-10 text-base sm:text-2xl text-red-400 font-bold">
            <h2 className="hover:text-red-600"><a href="#Home"> Projects </a></h2>
            <h2 className="hover:text-red-600"><a href="#About_Me"> About Me </a></h2>
            <h2 className="hover:text-red-600"><a href="https://github.com/ARakhamimov/portfolio" target="_blank"> GitHub </a></h2>
        </div>
      </div>

  );
}
