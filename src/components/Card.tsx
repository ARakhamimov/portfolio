// import placeholderImage from "../assets/placeholder.jpg"
// import placeholderImage from "../assets/placeholder_noise.png"
import "../styles/Card.css"
import "../styles/Card_Buttons.css"

type cardInfoProps = {
    image: string
    title: string
    field: string
    description: string
    func: () => void
}

function Card(cardInfo: cardInfoProps) {
  return (
    <div className="card">
        <img className="card-image" alt="card image failed to load :(" src={cardInfo.image} ></img>
        <div className="card_text">
            <div>
                <h2 className="card-title">{cardInfo.title}</h2>
                <h3 className="card-field">{cardInfo.field}</h3>
            </div>
            <p className="card-description">{cardInfo.description}</p>
            <div className="card_buttons">
                <button className="start-button" onClick={cardInfo.func}><span>Start</span></button>
                {/*<button className="video-button"><span>Video</span></button>*/}
                {/*<button className="docs-button"><span>Docs</span></button>*/}
            </div>
        </div>
    </div>
  );
}

export default Card;