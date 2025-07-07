// import placeholderImage from "../assets/placeholder.jpg"
// import placeholderImage from "../assets/placeholder_noise.png"
import "../styles/Card.css"
import Card_Buttons from "./Card_Buttons.tsx";

type cardInfoProps = {
    image: string
    title: string
    field: string
    description: string
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
            <Card_Buttons />
        </div>
    </div>
  );
}

export default Card;