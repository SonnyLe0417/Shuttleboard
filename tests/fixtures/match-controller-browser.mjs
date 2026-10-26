import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { useBadmintonMatch } from "../../src/hooks/useBadmintonMatch";
import { createVoiceController } from "../../src/lib/voice";
import { sfx } from "../../src/lib/audio";
import { haptics } from "../../src/lib/haptics";
let recognition;
window.SpeechRecognition = class {
  constructor() {
    recognition = this;
  }
  start() {}
  stop() {}
};
window.effects = { sound: 0, vibration: 0 };
sfx.point = () => window.effects.sound++;
haptics.tap = () => window.effects.vibration++;
function App() {
  const match = useBadmintonMatch();
  useEffect(() => {
    const voice = createVoiceController(() => ["Team A", "Team B"]);
    voice.setListener((command) => {
      if (command.type === "point") match.addPoint(command.team);
    });
    voice.start();
    return () => voice.stop();
  }, [match.addPoint]);
  return React.createElement(
    "main",
    null,
    React.createElement(
      "button",
      {
        onClick: () =>
          recognition.onresult({
            resultIndex: 0,
            results: [
              { 0: { transcript: "point a" }, isFinal: true },
              { 0: { transcript: "point a" }, isFinal: true },
            ],
          }),
      },
      "Two voice commands",
    ),
    React.createElement("button", { onClick: match.undo }, "Undo"),
    React.createElement("output", null, match.state.score.join("-")),
  );
}
createRoot(document.getElementById("root")).render(
  React.createElement(React.StrictMode, null, React.createElement(App)),
);
