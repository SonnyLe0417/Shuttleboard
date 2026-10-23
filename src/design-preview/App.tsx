import ScoreboardExample from "../components/club/ScoreboardExample";
import "../components/club/score-example.css";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Home,
  Menu,
  MoreHorizontal,
  Plus,
  SlidersHorizontal,
  Target,
  Upload,
  Video,
  X,
} from "lucide-react";
import hero from "./assets/badminton-1200.webp";
import heroSmall from "./assets/badminton-600.webp";
import matchPhoto from "./assets/match-1200.webp";
import "./preview.css";

type Screen = "landing" | "dashboard" | "video";
type Fixture = "populated" | "empty" | "loading" | "error";
type VideoStep = "Upload" | "Set court" | "Analyze" | "Review";
const screens: Screen[] = ["landing", "dashboard", "video"];
const screenNames = { landing: "Website", dashboard: "Dashboard", video: "Video analysis" };
const secondary = [
  { title: "Your game", items: ["History", "Progress"] },
  { title: "Your club", items: ["Community"] },
  { title: "Tools & learning", items: ["AI Referee", "Rules", "Junior Rankings"] },
  { title: "Account", items: ["Profile", "Settings"] },
];
const matches = [
  {
    name: "You & Alex vs. Jamie & Sam",
    detail: "Doubles · Saturday, 12 October",
    score: "21–18, 21–16",
    result: "Won",
  },
  {
    name: "You vs. Morgan",
    detail: "Singles · Thursday, 10 October",
    score: "18–21, 21–17, 19–21",
    result: "Lost",
  },
  {
    name: "You & Alex vs. Robin & Lee",
    detail: "Doubles · Tuesday, 8 October",
    score: "21–15, 21–19",
    result: "Won",
  },
];
const rallies = [
  {
    time: "00:12",
    title: "A patient opening",
    note: "Follow the exchange from the first serve.",
    type: "Detected",
  },
  {
    time: "00:34",
    title: "The change of pace",
    note: "Check the final contact before confirming the point.",
    type: "Needs review",
  },
  {
    time: "00:58",
    title: "Back to the rear court",
    note: "A short gap in tracking contains estimated positions.",
    type: "Estimated",
  },
  {
    time: "01:21",
    title: "Finding the open space",
    note: "Review the rally, then confirm or correct the winner.",
    type: "Detected",
  },
];

function Mark({ className = "" }: { className?: string }) {
  return (
    <svg className={`shuttle-mark ${className}`} viewBox="0 0 48 48" fill="none" aria-hidden="true">
      <path
        d="M8 7 16 32H32L40 7 29 11 24 5 19 11Z"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinejoin="round"
      />
      <path
        d="M19 11 21 32M29 11 27 32M10 14 17 18M38 14 31 18M16 32H32V35A8 8 0 0 1 16 35Z"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}
function Brand({ onClick }: { onClick: () => void }) {
  return (
    <button className="brand" onClick={onClick} aria-label="ShuttleBoard website">
      <Mark />
      <span>
        ShuttleBoard<span className="brand-dot">.</span>
      </span>
    </button>
  );
}
function Button({
  children,
  onClick,
  secondary: quiet = false,
  disabled = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      className={`button ${quiet ? "button-secondary" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
function Photo({ className = "", eager = false }: { className?: string; eager?: boolean }) {
  return (
    <img
      className={className}
      src={hero}
      srcSet={`${heroSmall} 600w, ${hero} 1200w`}
      sizes="(max-width: 700px) 100vw, 50vw"
      width="1200"
      height="1800"
      alt="Two badminton players preparing for the next shot on a blue indoor court"
      loading={eager ? "eager" : "lazy"}
      fetchPriority={eager ? "high" : "auto"}
    />
  );
}
function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  return (
    <dialog ref={ref} onCancel={onClose} className="modal" aria-labelledby={titleId}>
      <div className="section-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close dialog">
          <X />
        </button>
      </div>
      {children}
    </dialog>
  );
}
function ScoreDemo() {
  return <ScoreboardExample />;
}

function Landing({
  navigate,
  show,
}: {
  navigate: (screen: Screen) => void;
  show: (title: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  return (
    <div className="landing">
      <header className="landing-header wrap">
        <Brand onClick={() => navigate("landing")} />
        <nav aria-label="Website navigation">
          <a href="#the-game">The game</a>
          <a href="#a-closer-look">A closer look</a>
          <button onClick={() => show("Sign in")}>
            Sign in <ArrowUpRight size={16} />
          </button>
        </nav>
        <button
          className="icon-button mobile-menu"
          aria-label="Open website menu"
          aria-expanded={menu}
          onClick={() => setMenu(!menu)}
        >
          {menu ? <X /> : <Menu />}
        </button>
      </header>
      {menu && (
        <nav className="mobile-links" aria-label="Mobile website navigation">
          <a href="#the-game" onClick={() => setMenu(false)}>
            The game
          </a>
          <a href="#a-closer-look" onClick={() => setMenu(false)}>
            A closer look
          </a>
          <button
            onClick={() => {
              setMenu(false);
              show("Sign in");
            }}
          >
            Sign in
          </button>
        </nav>
      )}
      <main id="main-content">
        <section className="hero wrap">
          <div className="hero-copy">
            <p className="eyebrow">
              <span className="tiny-line" /> FOR THE LOVE OF THE GAME
            </p>
            <h1>
              Your next
              <br />
              good game
              <br />
              <span>starts here.</span>
            </h1>
            <p className="hero-description">
              Keep the score. Find the moments that matter.
              <br className="desktop-only" /> Bring a little more to your next badminton match.
            </p>
            <div className="hero-actions">
              <Button
                onClick={() =>
                  document.getElementById("the-game")?.scrollIntoView({
                    behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
                      ? "instant"
                      : "smooth",
                  })
                }
              >
                Try scoring a match <ArrowUpRight size={19} />
              </Button>
              <button className="text-button" onClick={() => navigate("video")}>
                Explore video analysis <ArrowRight size={17} />
              </button>
            </div>
            <p className="fine-print">One free preview match. Create an account to keep playing.</p>
            <div className="hero-bottom">
              <span>
                FOR EVERY PLAYER.
                <br />
                EVERY KIND OF GAME.
              </span>
              <ArrowDown size={24} />
            </div>
          </div>
          <figure className="hero-photo">
            <Photo eager />
            <figcaption>
              <span>Meet you on court.</span>
              <span>01 / THE GAME</span>
            </figcaption>
          </figure>
        </section>
        <div className="feature-strip wrap">
          <span>Less keeping track. More playing.</span>
          <p>
            Singles & doubles <span> / </span> Match history <span> / </span> Video review
          </p>
        </div>
        <section id="the-game" className="editorial-section wrap">
          <div>
            <p className="eyebrow">01 / PLAY</p>
            <h2>
              Stay in the rally.
              <br />
              We’ll keep the score.
            </h2>
            <p>
              Big numbers. Clear serving guidance. One tap to score, one tap to undo. Made for the
              moments between points.
            </p>
            <button className="text-button" onClick={() => show("Free scoreboard preview")}>
              Start your preview match <ArrowRight size={18} />
            </button>
          </div>
          <ScoreDemo />
        </section>
        <section id="a-closer-look" className="analysis-story wrap">
          <figure>
            <img
              src={matchPhoto}
              alt="A badminton player preparing to serve across the net"
              width="1200"
              height="801"
              loading="lazy"
            />
          </figure>
          <div>
            <p className="eyebrow">02 / LOOK BACK</p>
            <h2>
              There’s more to
              <br />a match than its score.
            </h2>
            <p>
              Revisit a rally. See where the shuttle went. Review the details and bring your own
              judgment to the game.
            </p>
            <Button secondary onClick={() => navigate("video")}>
              Take a closer look <ArrowUpRight size={18} />
            </Button>
            <p className="fine-print">
              TrackNet analysis requires the local service running on your computer. Browser
              analysis is also available.
            </p>
          </div>
        </section>
        <section className="closing wrap">
          <p className="eyebrow">03 / KEEP GOING</p>
          <h2>
            A record of your game.
            <br />
            Room for your next chapter.
          </h2>
          <p>Your matches, personal goals, and progress. Together in one place.</p>
          <Button onClick={() => navigate("dashboard")}>
            Explore your dashboard <ArrowRight size={18} />
          </Button>
        </section>
      </main>
      <footer className="landing-footer wrap">
        <Brand onClick={() => navigate("landing")} />
        <span>Made for the next game.</span>
        <a
          href="https://www.pexels.com/photo/aerial-view-of-badminton-players-in-action-31790661/"
          target="_blank"
          rel="noreferrer"
        >
          Photography: Noel Snpr / Pexels
        </a>
      </footer>
    </div>
  );
}
function Shell({
  screen,
  navigate,
  show,
  children,
}: {
  screen: Screen;
  navigate: (screen: Screen) => void;
  show: (title: string) => void;
  children: ReactNode;
}) {
  const [more, setMore] = useState(false);
  const links = [
    {
      label: "Home",
      icon: Home,
      action: () => navigate("dashboard"),
      active: screen === "dashboard",
    },
    { label: "Play", icon: Plus, action: () => show("Play a match"), active: false },
    { label: "Analyze", icon: Video, action: () => navigate("video"), active: screen === "video" },
  ];
  const groups = (
    <>
      {secondary.map((group) => (
        <section className="nav-group" key={group.title}>
          <h3>{group.title}</h3>
          {group.items.map((item) => (
            <button
              key={item}
              onClick={() => {
                setMore(false);
                show(item);
              }}
            >
              {item}
              <ChevronRight size={14} />
            </button>
          ))}
        </section>
      ))}
    </>
  );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand onClick={() => navigate("landing")} />
        <p className="sidebar-caption">YOUR SIDE OF THE COURT</p>
        <nav aria-label="Main navigation">
          {links.map(({ label, icon: Icon, action, active }) => (
            <button
              className={active ? "nav-active" : ""}
              aria-current={active ? "page" : undefined}
              key={label}
              onClick={action}
            >
              <Icon size={19} />
              {label}
              {label === "Play" && <span className="nav-plus">+</span>}
            </button>
          ))}
        </nav>
        {groups}
        <div className="sidebar-account">
          <span className="avatar">JD</span>
          <div>
            <strong>Jamie Davis</strong>
            <span>Example player</span>
          </div>
        </div>
      </aside>
      <div className="app-main">
        <header className="app-top">
          <div className="desktop-only">
            Your game / <strong>{screen === "dashboard" ? "Home" : "Video analysis"}</strong>
          </div>
          <div className="mobile-brand">
            <Brand onClick={() => navigate("landing")} />
          </div>
          <span className="example-tag">EXAMPLE DATA</span>
        </header>
        {children}
      </div>
      <nav className="bottom-nav" aria-label="Phone navigation">
        {links.map(({ label, icon: Icon, action, active }) => (
          <button
            key={label}
            onClick={action}
            aria-current={active ? "page" : undefined}
            className={active ? "nav-active" : ""}
          >
            <Icon size={21} />
            <span>{label}</span>
          </button>
        ))}
        <button onClick={() => setMore(true)} aria-haspopup="dialog">
          <MoreHorizontal size={21} />
          <span>More</span>
        </button>
      </nav>
      {more && (
        <Modal title="More from ShuttleBoard" onClose={() => setMore(false)}>
          {groups}
        </Modal>
      )}
    </div>
  );
}
function StatePanel({
  fixture,
  retry,
  action,
}: {
  fixture: Fixture;
  retry: () => void;
  action: () => void;
}) {
  if (fixture === "loading")
    return (
      <div className="state-panel" role="status">
        <div className="skeleton" />
        <div className="skeleton short" />
        <p>Loading your matches…</p>
      </div>
    );
  return (
    <div className="state-panel" role={fixture === "error" ? "alert" : undefined}>
      <div className="state-icon">{fixture === "error" ? <CircleHelp /> : <Mark />}</div>
      <h2>
        {fixture === "error" ? "Your matches couldn’t load." : "Your first game starts here."}
      </h2>
      <p>
        {fixture === "error"
          ? "Your saved matches are safe. Try loading them again."
          : "Start a match and give your badminton story its first entry."}
      </p>
      <Button onClick={fixture === "error" ? retry : action}>
        {fixture === "error" ? "Try again" : "Start a match"}
        <ArrowRight size={17} />
      </Button>
    </div>
  );
}
function Dashboard({
  fixture,
  retry,
  navigate,
  show,
}: {
  fixture: Fixture;
  retry: () => void;
  navigate: (screen: Screen) => void;
  show: (title: string) => void;
}) {
  const [details, setDetails] = useState(false);
  const [active, setActive] = useState(false);
  return (
    <main id="main-content" className="dashboard page-content">
      <div className="page-heading">
        <div>
          <p className="eyebrow">A LITTLE BETTER, EVERY GAME</p>
          <h1>Good to see you, Jamie.</h1>
          <p>Make some time for your game.</p>
        </div>
        <span className="date-label">YOUR CLUBHOUSE</span>
      </div>
      <div className="action-grid">
        <section className="play-card">
          <div className="court-decoration" aria-hidden="true">
            <i />
            <i />
          </div>
          <p className="eyebrow">ON COURT</p>
          <h2>{active ? "There’s a game to finish." : "Who’s up for a game?"}</h2>
          <p>
            {active
              ? "Your example match is ready to resume."
              : "Singles or doubles. Friendly or fiercely competitive."}
          </p>
          <Button
            onClick={() => {
              setActive(true);
              show("Play a match");
            }}
          >
            {active ? "Resume match" : "Start a match"}
            <ArrowUpRight size={18} />
          </Button>
        </section>
        <section className="analyze-card">
          <Video size={24} />
          <div>
            <p className="eyebrow">OFF COURT</p>
            <h2>Watch. Notice. Improve.</h2>
            <p>Give your last match a second look.</p>
          </div>
          <button className="text-button" onClick={() => navigate("video")}>
            Analyze a video <ArrowRight size={18} />
          </button>
        </section>
      </div>
      <div className="dashboard-columns">
        <section className="recent">
          <div className="section-heading">
            <h2>Recent matches</h2>
            <button className="text-button" onClick={() => show("History")}>
              All matches <ArrowUpRight size={16} />
            </button>
          </div>
          {fixture !== "populated" ? (
            <StatePanel fixture={fixture} retry={retry} action={() => show("Play a match")} />
          ) : (
            <>
              <div className="match-list">
                {matches.map((match, i) => (
                  <button
                    className="match-row"
                    key={match.name}
                    onClick={() => show(`Match ${i + 1} details`)}
                  >
                    <span className={`result ${match.result.toLowerCase()}`}>
                      {match.result === "Won" ? "W" : "L"}
                    </span>
                    <span className="match-name">
                      <strong>{match.name}</strong>
                      <span>{match.detail}</span>
                    </span>
                    <span className="match-score">{match.score}</span>
                    <ChevronRight size={17} />
                  </button>
                ))}
              </div>
              <div className="section-heading progress-heading">
                <h2>A little perspective</h2>
                <button
                  className="text-button"
                  aria-expanded={details}
                  onClick={() => setDetails(!details)}
                >
                  {details ? "Less detail" : "More detail"}
                  <SlidersHorizontal size={16} />
                </button>
              </div>
              <div className="stats">
                <div>
                  <span>Matches this month</span>
                  <strong>8</strong>
                  <small>Time well spent on court</small>
                </div>
                <div>
                  <span>Games won</span>
                  <strong>
                    11 <small>/ 18</small>
                  </strong>
                  <small>Across singles and doubles</small>
                </div>
                <div>
                  <span>Time on court</span>
                  <strong>
                    4.5 <small>hrs</small>
                  </strong>
                  <small>Keep showing up</small>
                </div>
              </div>
              {details && (
                <div className="detail-note">
                  <BarChart3 size={20} />
                  <p>
                    Example breakdown: 5 doubles matches and 3 singles matches. Detailed progress
                    remains available from the navigation.
                  </p>
                  <button className="text-button" onClick={() => show("Progress")}>
                    View progress <ArrowRight size={16} />
                  </button>
                </div>
              )}
            </>
          )}
        </section>
        <aside className="goal-card">
          <Target size={24} />
          <p className="eyebrow">YOUR NEXT SMALL WIN</p>
          <h2>
            Make it to court
            <br />
            twice this week.
          </h2>
          <p>
            {fixture === "empty" ? "A little time for your game." : "One good session down."}
            <br />
            {fixture === "empty" ? "Start with your first match." : "One more to look forward to."}
          </p>
          <div
            className="goal-progress"
            role="progressbar"
            aria-label="Weekly match goal"
            aria-valuemin={0}
            aria-valuemax={2}
            aria-valuenow={fixture === "empty" ? 0 : 1}
          >
            <span style={{ width: fixture === "empty" ? "0%" : "50%" }} />
          </div>
          <div className="goal-count">
            <strong>{fixture === "empty" ? "0" : "1"} of 2 matches</strong>
            <span>This week</span>
          </div>
          <button className="text-button" onClick={() => show("Edit your goal")}>
            Edit goal <ArrowUpRight size={16} />
          </button>
        </aside>
      </div>
      <p className="page-footnote">
        Your game, at your pace. <span>All names and statistics on this preview are examples.</span>
      </p>
    </main>
  );
}
function VideoWorkspace({ fixture }: { fixture: Fixture }) {
  const [step, setStep] = useState<VideoStep>(
    fixture === "empty" ? "Upload" : fixture === "loading" ? "Analyze" : "Review",
  );
  const [selected, setSelected] = useState(1);
  const [confirmed, setConfirmed] = useState<number[]>([]);
  const [winners, setWinners] = useState<Record<number, string>>({});
  const winner = winners[selected] ?? "Near side";
  const [corners, setCorners] = useState(0);
  const [cancelled, setCancelled] = useState(false);
  const [full, setFull] = useState(false);
  const [errorCleared, setErrorCleared] = useState(false);
  const workspace = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sync = () => setFull(document.fullscreenElement === workspace.current);
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);
  async function fullscreen() {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await workspace.current?.requestFullscreen();
  }
  const steps: VideoStep[] = ["Upload", "Set court", "Analyze", "Review"];
  return (
    <main id="main-content" className="page-content video-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">A FRESH LOOK AT YOUR GAME</p>
          <h1>There’s a story in every rally.</h1>
          <p>Take your time. Find your next thing to work on.</p>
        </div>
        <Button
          secondary
          onClick={() => {
            setStep("Upload");
            setCancelled(false);
            setErrorCleared(true);
            setConfirmed([]);
            setWinners({});
            setCorners(0);
          }}
        >
          New analysis <Plus size={17} />
        </Button>
      </div>
      <nav className="workflow" aria-label="Analysis steps">
        {steps.map((item, i) => (
          <button
            key={item}
            onClick={() => setStep(item)}
            aria-current={step === item ? "step" : undefined}
          >
            <span>{i < steps.indexOf(step) ? <Check size={14} /> : `0${i + 1}`}</span>
            {item}
          </button>
        ))}
      </nav>
      <div className="preview-inline-note">
        Interactive layout preview · Sample still and illustrative rally data, not an AI result.
      </div>
      {(fixture === "error" && !errorCleared) || cancelled ? (
        <div className="analysis-alert" role="alert">
          <CircleHelp size={21} />
          <div>
            <strong>
              {cancelled ? "Example analysis cancelled" : "TrackNet service isn’t connected"}
            </strong>
            <p>
              {cancelled
                ? "Your video and court setup would stay available for another attempt."
                : "Start your local service, then try again. Browser analysis remains an option."}
            </p>
          </div>
          <Button
            secondary
            onClick={() => {
              setCancelled(false);
              setErrorCleared(true);
              setStep("Analyze");
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {step === "Upload" ? (
        <section className="upload-stage">
          <Upload size={35} />
          <h2>Bring your game into focus.</h2>
          <p>Choose a match clip, set the court, then review the rallies.</p>
          <Button
            onClick={() => {
              setStep("Set court");
              setCorners(0);
            }}
          >
            Use example clip <ArrowRight size={18} />
          </Button>
          <p className="fine-print">Preview only. No files are uploaded.</p>
          <details>
            <summary>Analysis options & setup</summary>
            <p>
              TrackNet needs a local service running on your computer. Browser analysis runs in your
              browser. Existing engine and accuracy settings will be retained.
            </p>
          </details>
        </section>
      ) : (
        <div ref={workspace} className={`video-workspace ${full ? "is-fullscreen" : ""}`}>
          <div className="video-stage">
            <div className="video-file">
              <span>
                <Video size={16} /> Saturday doubles <span className="muted-dark">/ Example</span>
              </span>
              <button
                className="text-button"
                onClick={() => void fullscreen().catch(() => setFull(false))}
              >
                {full ? "Exit full screen" : "Full screen"}
                <ArrowUpRight size={16} />
              </button>
            </div>
            <div className="video-still">
              <img
                src={matchPhoto}
                width="1200"
                height="801"
                alt="Example badminton frame showing a player preparing to serve"
              />
              <span className="still-label">EXAMPLE STILL</span>
              {step === "Set court" && (
                <div className="calibration-overlay">
                  <span>{corners} of 4 example corners set</span>
                  <Button
                    onClick={() => setCorners(Math.min(4, corners + 1))}
                    disabled={corners === 4}
                  >
                    Set example corner <Plus size={16} />
                  </Button>
                </div>
              )}
            </div>
            <div className="frame-caption">
              <span>
                <Clock3 size={15} /> {rallies[selected].time}{" "}
                <span className="muted-dark">/ Example timeline</span>
              </span>
              <span>Still preview · no playback</span>
            </div>
            <div className="rally-timeline" aria-label="Example rally timeline">
              {rallies.map((r, i) => (
                <button
                  key={r.time}
                  aria-label={`Select rally ${i + 1} at ${r.time}`}
                  aria-pressed={i === selected}
                  onClick={() => setSelected(i)}
                >
                  <span />
                  <small>{r.time}</small>
                </button>
              ))}
            </div>
            <div className="timeline-legend">
              <span>
                <i /> Detected
              </span>
              <span>
                <i className="estimated" /> Estimated
              </span>
              <span>Review before confirming a point</span>
            </div>
          </div>
          <aside className="review-panel">
            {step === "Set court" ? (
              <>
                <p className="eyebrow">SET THE COURT</p>
                <h2>A clear view starts here.</h2>
                <p>
                  Mark the four court corners in the full app. Court and net calibration, camera
                  changes, and view options remain part of this step.
                </p>
                <Button disabled={corners < 4} onClick={() => setStep("Analyze")}>
                  Analyze example <ArrowRight size={17} />
                </Button>
                <button className="text-button" onClick={() => setCorners(0)}>
                  Reset corners
                </button>
              </>
            ) : cancelled ? (
              <>
                <p className="eyebrow">ANALYSIS STOPPED</p>
                <h2>Ready when you are.</h2>
                <p>
                  Your example clip and court setup are still available. Choose Try again to
                  restart.
                </p>
              </>
            ) : step === "Analyze" ? (
              <>
                <p className="eyebrow">TRACKING THE MATCH</p>
                <h2>Finding the rallies.</h2>
                <p>Your analysis can continue while you explore the app.</p>
                <div
                  className="goal-progress"
                  role="progressbar"
                  aria-label="Example analysis progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={64}
                >
                  <span style={{ width: "64%" }} />
                </div>
                <p>64% · Example progress</p>
                <Button onClick={() => setStep("Review")}>
                  View example results <ArrowRight size={17} />
                </Button>
                <button className="text-button" onClick={() => setCancelled(true)}>
                  Cancel analysis
                </button>
              </>
            ) : (
              <>
                <div className="section-heading">
                  <h2>Rally notes</h2>
                  <span className="small">4 examples</span>
                </div>
                <div className="rally-list">
                  {rallies.map((r, i) => (
                    <button
                      key={r.time}
                      aria-pressed={selected === i}
                      className={selected === i ? "selected" : ""}
                      onClick={() => {
                        setSelected(i);
                      }}
                    >
                      <span className="rally-number">{String(i + 1).padStart(2, "0")}</span>
                      <span>
                        <strong>{r.title}</strong>
                        <small>
                          {r.time} · {confirmed.includes(i) ? "Confirmed" : r.type}
                        </small>
                      </span>
                      <ChevronRight size={15} />
                    </button>
                  ))}
                </div>
                <div className="selected-rally">
                  <p className="eyebrow">RALLY {String(selected + 1).padStart(2, "0")}</p>
                  <h3>{rallies[selected].title}</h3>
                  <p>{rallies[selected].note}</p>
                  <label className="field-label" htmlFor="winner">
                    Point awarded to
                  </label>
                  <select
                    id="winner"
                    value={winner}
                    disabled={confirmed.includes(selected)}
                    onChange={(e) => setWinners({ ...winners, [selected]: e.target.value })}
                  >
                    <option>Near side</option>
                    <option>Far side</option>
                    <option>Uncertain — review later</option>
                  </select>
                  <Button
                    disabled={confirmed.includes(selected) || winner === "Uncertain — review later"}
                    onClick={() => setConfirmed([...confirmed, selected])}
                  >
                    {confirmed.includes(selected)
                      ? "Confirmed in preview"
                      : "Confirm example point"}
                    <Check size={17} />
                  </Button>
                  <p className="fine-print" aria-live="polite">
                    {confirmed.includes(selected)
                      ? `Example saved for ${winner.toLowerCase()}. No match data changed.`
                      : "You make the final call."}
                  </p>
                </div>
              </>
            )}
          </aside>
        </div>
      )}
      <details className="advanced">
        <summary>
          <SlidersHorizontal size={18} /> Analysis settings & diagnostics
        </summary>
        <div className="advanced-content">
          <p>
            These controls illustrate where existing options will live. No engine configuration is
            changed in this preview.
          </p>
          <div className="advanced-fields">
            <label>
              Analysis mode
              <select defaultValue="TrackNet">
                <option>TrackNet</option>
                <option>Browser</option>
              </select>
            </label>
            <label>
              TrackNet engine
              <select defaultValue="Current">
                <option>Current</option>
                <option>V3</option>
              </select>
            </label>
          </div>
          <p>
            Detected positions and estimated repairs remain distinct. Confidence, calibration,
            camera segments, and diagnostic details remain available.
          </p>
        </div>
      </details>
    </main>
  );
}
export default function App() {
  const initial = location.hash.slice(1) as Screen;
  const [screen, setScreen] = useState<Screen>(screens.includes(initial) ? initial : "landing");
  const [fixture, setFixture] = useState<Fixture>("populated");
  const [dark, setDark] = useState(false);
  const [large, setLarge] = useState(false);
  const [modal, setModal] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => {
      const next = location.hash.slice(1) as Screen;
      if (screens.includes(next)) setScreen(next);
    };
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  function navigate(next: Screen) {
    location.hash = next;
    setScreen(next);
    setFixture("populated");
    window.scrollTo(0, 0);
  }
  return (
    <div className={`design-preview ${dark ? "theme-dark" : ""} ${large ? "large-text" : ""}`}>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div className="review-toolbar" aria-label="Design preview controls">
        <span className="review-label">
          DESIGN REVIEW <span>01</span>
        </span>
        <div className="screen-switch">
          {screens.map((s) => (
            <button key={s} aria-pressed={s === screen} onClick={() => navigate(s)}>
              {screenNames[s]}
            </button>
          ))}
        </div>
        <div className="review-options">
          {screen !== "landing" && (
            <label>
              <span className="sr-only">Example state</span>
              <select
                aria-label="Example state"
                value={fixture}
                onChange={(e) => setFixture(e.target.value as Fixture)}
              >
                <option value="populated">Populated</option>
                <option value="empty">First use</option>
                <option value="loading">Loading</option>
                <option value="error">Error</option>
              </select>
            </label>
          )}
          <button aria-pressed={dark} onClick={() => setDark(!dark)}>
            {dark ? "Light" : "Dark"}
          </button>
          <button aria-label="Large text" aria-pressed={large} onClick={() => setLarge(!large)}>
            Aa
          </button>
        </div>
      </div>
      {screen === "landing" ? (
        <Landing navigate={navigate} show={setModal} />
      ) : (
        <Shell screen={screen} navigate={navigate} show={setModal}>
          {screen === "dashboard" ? (
            <Dashboard
              fixture={fixture}
              retry={() => setFixture("populated")}
              navigate={navigate}
              show={setModal}
            />
          ) : (
            <VideoWorkspace key={fixture} fixture={fixture} />
          )}
        </Shell>
      )}
      {modal && (
        <Modal title={modal} onClose={() => setModal(null)}>
          {modal === "Play a match" || modal === "Free scoreboard preview" ? (
            <>
              <p className="modal-note">
                Interactive design example. This does not start or save a real match.
              </p>
              <ScoreDemo />
            </>
          ) : (
            <>
              <p>
                This destination is retained in the redesign. Its full screen will be designed after
                the three core screens are reviewed.
              </p>
              <p className="modal-note">
                This isolated preview uses example data and does not connect to your account.
              </p>
              <Button onClick={() => setModal(null)}>
                Back to preview <ArrowLeft size={17} />
              </Button>
            </>
          )}
        </Modal>
      )}
    </div>
  );
}
