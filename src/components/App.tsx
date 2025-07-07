import Card from "./Card.tsx";
import multigridHeatTransferGif from "../assets/multigrid_heat_transfer.gif"
import reactionDiffusionGif from "../assets/reaction_diffusion.gif"

function App() {
    const deck_info = [
        {
            image: multigridHeatTransferGif,
            title: "Multigrid Heat Equation",
            field: "Transport Phenomena",
            description: "Solve the 2D steady state heat equation with complex boundary conditions. Compare Gauss-Seidel iteration to Multigrid methods. Implemented with WebGPU!",
        },
        {
            image: reactionDiffusionGif,
            title: "Reaction Diffusion Equation",
            field: "Transport Phenomena",
            description: "A reaction-diffusion system is simulated with Gauss-Seidel for diffusion and forward Euler for reaction. Complex boundary conditions can be used and boundary conditions can change mid-simulation. Implemented with WebGPU!"
        }
    ]

    return (
    <>
        <header>
            <nav>
                <h1><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" target="_blank" className="my_name">Allen
                Rakhamimov</a></h1>
                <ul className="nav__links">
                    <li><a href="#Projects"> Projects </a></li>
                    <li><a href="#About"> About </a></li>
                </ul>
            </nav>
        </header>
        <h1 id="Projects">Projects</h1>
        <div className="deck">
            {deck_info.map((projectInfo) => (
                <Card key={projectInfo.title} {...projectInfo} />
            ))}
        </div>
        <h1 id="About">About</h1>
        <div className="deck">

        </div>
    </>
    )
}

export default App
