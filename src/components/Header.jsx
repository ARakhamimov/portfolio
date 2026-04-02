import { Container, Group } from '@mantine/core';
import React from "react";

export default function Header() {
  return (
      <div className="bg-zinc-50 shadow-sm shadow-red-400 flex justify-between sticky top-0 z-50 lg:flex-nowrap flex-wrap">
        <h1 className="text-4xl text-red-600 hover:text-red-800 font-serif font-bold content-center py-6 px-12">
            <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" target="_blank"> Allen Rakhamimov</a>
        </h1>
        <div className="flex text-2xl text-red-400 font-bold">
            <h2 className="content-center px-10 hover:text-red-600"><a href="#Home"> Projects </a></h2>
            <h2 className="content-center px-10 hover:text-red-600"><a href="#About_Me"> About Me </a></h2>
        </div>
      </div>

  );
}