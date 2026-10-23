import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowRight, ArrowUpRight, Menu, X } from "lucide-react";
import { useSession } from "@/hooks/useSession";
import { ClubBrand } from "@/components/layout/ClubBrand";
import ScoreboardExample from "@/components/club/ScoreboardExample";
import "@/components/club/score-example.css";
import "@/components/club/landing.css";
import hero from "@/assets/club/badminton-1200.webp";
import heroSmall from "@/assets/club/badminton-600.webp";
import matchPhoto from "@/assets/club/match-1200.webp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "ShuttleBoard — Badminton Scores & Video Analysis" },
      {
        name: "description",
        content:
          "Score badminton matches, review your match videos, and follow your progress with ShuttleBoard.",
      },
    ],
  }),
  component: LandingPage,
});
function LandingPage() {
  const { user } = useSession();
  const [menu, setMenu] = useState(false);
  return (
    <div className="club-landing">
      <header className="club-public-header">
        <ClubBrand />
        <nav aria-label="Website navigation">
          <a href="#the-game">The game</a>
          <a href="#a-closer-look">A closer look</a>
          <Link to={user ? "/dashboard" : "/auth"}>
            {user ? "Your dashboard" : "Sign in"}
            <ArrowUpRight size={16} />
          </Link>
        </nav>
        <button
          className="club-menu-button"
          aria-label={menu ? "Close website menu" : "Open website menu"}
          aria-expanded={menu}
          aria-controls="website-menu"
          onClick={() => setMenu(!menu)}
        >
          {menu ? <X /> : <Menu />}
        </button>
      </header>
      {menu && (
        <nav id="website-menu" className="club-public-menu" aria-label="Mobile website navigation">
          <a onClick={() => setMenu(false)} href="#the-game">
            The game
          </a>
          <a onClick={() => setMenu(false)} href="#a-closer-look">
            A closer look
          </a>
          <Link to={user ? "/dashboard" : "/auth"}>{user ? "Your dashboard" : "Sign in"}</Link>
        </nav>
      )}
      <section className="club-hero">
        <div>
          <p className="eyebrow">For the love of badminton</p>
          <h1>
            Your next
            <br />
            good game
            <br />
            <em>starts here.</em>
          </h1>
          <p className="club-hero-copy">
            Keep the score. Find the moments that matter.
            <br />
            Bring a little more to your next badminton match.
          </p>
          <div className="club-hero-actions">
            <Link to="/scoreboard" className="button-primary">
              Try scoring a match <ArrowUpRight size={18} />
            </Link>
            <Link to="/video">
              Explore video analysis <ArrowRight size={18} />
            </Link>
          </div>
          {!user && (
            <p className="club-fine-print">
              One free preview match. Create an account to keep playing.
            </p>
          )}
          <p className="club-hero-signoff">
            For every player.
            <br />
            Every kind of game.
          </p>
        </div>
        <figure>
          <img
            src={hero}
            srcSet={`${heroSmall} 600w, ${hero} 1200w`}
            sizes="(max-width:700px) 100vw, 50vw"
            width="1200"
            height="1800"
            fetchPriority="high"
            alt="Two badminton players on a blue indoor court"
          />
          <figcaption>
            <span>Meet you on court.</span>
            <span>01 / THE GAME</span>
          </figcaption>
        </figure>
      </section>
      <div className="club-landing-strip">
        <strong>Less keeping track. More playing.</strong>
        <span>Singles & doubles / Match history / Video review</span>
      </div>
      <section id="the-game" className="club-landing-story">
        <div>
          <p className="eyebrow">01 / Play</p>
          <h2>
            Stay in the rally.
            <br />
            We’ll keep the score.
          </h2>
          <p>
            Big numbers. Clear serving guidance. One tap to score, one tap to undo. Made for the
            moments between points.
          </p>
          <Link to="/scoreboard">
            Start a match <ArrowRight size={18} />
          </Link>
        </div>
        <ScoreboardExample />
      </section>
      <section id="a-closer-look" className="club-landing-story">
        <img
          src={matchPhoto}
          width="1200"
          height="801"
          loading="lazy"
          alt="A badminton player preparing to serve"
        />
        <div>
          <p className="eyebrow">02 / Look back</p>
          <h2>There’s more to a match than its score.</h2>
          <p>
            Revisit a rally. See where the shuttle went. Review the details and bring your own
            judgment to the game.
          </p>
          <Link to="/video">
            Take a closer look <ArrowRight size={18} />
          </Link>
          <p className="club-fine-print">
            TrackNet analysis requires the local service running on your computer. Browser analysis
            is also available.
          </p>
        </div>
      </section>
      <section className="club-landing-close">
        <p className="eyebrow">03 / Keep going</p>
        <h2>
          A record of your game.
          <br />
          Room for your next chapter.
        </h2>
        <p>Your matches, personal goals, and progress. Together in one place.</p>
        <Link to="/dashboard" className="button-primary">
          Explore your dashboard <ArrowRight size={18} />
        </Link>
      </section>
      <footer className="club-public-footer">
        <ClubBrand />
        <p>Made for the next game.</p>
        <a href="https://www.pexels.com/photo/aerial-view-of-badminton-players-in-action-31790661/">
          Photography: Noel Snpr / Pexels
        </a>
      </footer>
    </div>
  );
}
