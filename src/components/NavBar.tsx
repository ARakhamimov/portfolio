type imTiredOfThis = {
    goHome: () => void
}

function NavBar(goHome: imTiredOfThis) {
    return (
        <>
            <header>
                <nav>
                    <h1><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" target="_blank" className="my_name">Allen
                    Rakhamimov</a></h1>
                    <ul className="nav__links">
                        <li><a href="#Projects" onClick={goHome.goHome}> Projects </a></li>
                        {/*<li><a href="#About" > About </a></li>*/}
                    </ul>
                </nav>
            </header>
        </>
    );
}

export default NavBar;