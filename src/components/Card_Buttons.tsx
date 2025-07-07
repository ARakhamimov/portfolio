import "../styles/Card.css"
import "../styles/Card_Buttons.css"

function Card_Buttons() {
  return (
    <div className="card_buttons">
        <button className="start-button"><span>Start</span></button>
        {/*<button className="video-button"><span>Video</span></button>*/}
        {/*<button className="docs-button"><span>Docs</span></button>*/}
    </div>
  );
}

export default Card_Buttons;