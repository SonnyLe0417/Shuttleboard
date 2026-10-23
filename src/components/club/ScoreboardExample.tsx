import { useState } from "react";
import { Plus, Undo2 } from "lucide-react";
import { findPreset, isGameOver, gameWinner } from "../../lib/badminton-rules";

const rules = findPreset("21");
export default function ScoreboardExample() {
  const [history, setHistory] = useState<Array<[number, number]>>([[18, 16]]);
  const score = history[history.length - 1];
  const over = isGameOver(score, rules);
  const winner = gameWinner(score, rules);
  return (
    <section className="club-score-example" aria-label="Interactive badminton scoreboard">
      <header>
        <strong>Try the scoreboard</strong>
        <span>21 points · cap 30</span>
      </header>
      <div className="club-score-teams">
        {score.map((points, team) => (
          <div key={team}>
            <p>{team === 0 ? "Your team" : "Their team"}</p>
            <output aria-live="polite" aria-label={`${team === 0 ? "Your" : "Their"} team score`}>
              {points}
            </output>
            <button
              disabled={over}
              onClick={() =>
                setHistory([
                  ...history,
                  score.map((n, i) => n + (i === team ? 1 : 0)) as [number, number],
                ])
              }
              aria-label={`Add a point to ${team === 0 ? "your" : "their"} team`}
            >
              <Plus size={17} />
              Point
            </button>
          </div>
        ))}
      </div>
      <footer>
        <button disabled={history.length === 1} onClick={() => setHistory(history.slice(0, -1))}>
          <Undo2 size={17} />
          Undo
        </button>
        <p role="status">
          {over
            ? `${winner === 0 ? "Your" : "Their"} team wins`
            : Math.min(...score) >= 20
              ? "Win by two · first to 30 wins"
              : "One point for every rally"}
        </p>
        <button onClick={() => setHistory([[0, 0]])}>Reset</button>
      </footer>
    </section>
  );
}
