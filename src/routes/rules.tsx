import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  ExternalLink,
  Gavel,
  Grid2X2,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Trophy,
  Users,
  Video,
} from "lucide-react";
import {
  activeLandingBox,
  correctServeSide,
  inServiceCourt,
  receiverCourt,
  COURT,
  type GameMode,
} from "@/lib/badminton";
import { PRESETS } from "@/lib/badminton-rules";

export const Route = createFileRoute("/rules")({
  head: () => ({
    meta: [
      { title: "Rules · ShuttleBoard" },
      {
        name: "description",
        content: "Interactive badminton rules, serve checker, referee tools, and practice quizzes.",
      },
    ],
  }),
  component: RulesPage,
});

type RuleItem = { icon: typeof Target; label: string; title: string; text: string; tags: string[] };
type Scenario = { question: string; options: string[]; answer: number; explanation: string };

const ruleItems: RuleItem[] = [
  {
    icon: Target,
    label: "Scoring",
    title: "Every rally awards a point.",
    text: "Games are normally played to 21. At 20-all, a side must lead by 2; at 29-all, the next point wins the game.",
    tags: ["scoring", "21", "games"],
  },
  {
    icon: Grid2X2,
    label: "Serving",
    title: "Even serves right; odd serves left.",
    text: "Use the server's score to choose the service court. The serve travels diagonally into the receiver's matching service box.",
    tags: ["serve", "service court", "singles"],
  },
  {
    icon: Users,
    label: "Doubles",
    title: "Partners keep the rally court wide.",
    text: "Doubles uses the wide sidelines during rallies, with a shorter back service line. The serving side keeps serving after winning a rally.",
    tags: ["doubles", "partners", "boundaries"],
  },
  {
    icon: BookOpen,
    label: "Singles",
    title: "Singles uses the narrow sidelines.",
    text: "Singles rallies use the inner sidelines and the full back boundary. The service box is long and narrow.",
    tags: ["singles", "boundaries", "service court"],
  },
  {
    icon: AlertTriangle,
    label: "Faults",
    title: "A fault ends the rally immediately.",
    text: "Common faults include an incorrect serve, shuttle out, net contact, double hit, carry, or striking before the shuttle crosses the net.",
    tags: ["fault", "net", "carry"],
  },
  {
    icon: CheckCircle2,
    label: "Line calls",
    title: "A line is in.",
    text: "If the shuttle touches a boundary line on first contact with the floor, it is in for that format and phase of play.",
    tags: ["lines", "in", "out"],
  },
  {
    icon: Clock3,
    label: "Intervals",
    title: "Use the breaks to reset.",
    text: "Standard matches include a short interval when the leading side reaches 11 in a game and a longer break between games.",
    tags: ["interval", "match flow"],
  },
  {
    icon: Trophy,
    label: "Match format",
    title: "Best of 3 is the standard race.",
    text: "The first side to win two games wins a best-of-three match. ShuttleBoard also supports 15-point, 11-point, and golden-point presets.",
    tags: ["match", "best of 3", "format"],
  },
];

const glossary = [
  ["Rally point", "A point is awarded after every rally, regardless of who served."],
  ["Let", "A rally is stopped and replayed without changing the score."],
  ["Carry", "The shuttle is caught or held on the racket instead of struck cleanly."],
  ["Interval", "A scheduled break in play, normally at 11 points and between games."],
  ["Flick serve", "A quick, deceptive serve sent higher and deeper toward the rear court."],
  ["Service court", "The diagonal box where a legal serve must land."],
  ["Drive", "A fast, flat shot that travels mostly horizontally over the net."],
  ["Clear", "A high or attacking shot sent deep toward the opponent's back court."],
];

const scenarios: Scenario[] = [
  {
    question: "The score is 8–7 and the server is on the right. Is the setup legal?",
    options: ["Yes, the server's score is even", "No, odd scores serve right", "Only in doubles"],
    answer: 1,
    explanation:
      "The server's own score is 8, so the correct serving side is the right. The setup is legal.",
  },
  {
    question:
      "A singles shot lands on the outer doubles sideline during a rally. What is the call?",
    options: ["In", "Out", "Let"],
    answer: 1,
    explanation:
      "Singles uses the inner sidelines. The outer doubles sideline is outside the active singles court.",
  },
  {
    question: "The shuttle clips the net and lands in the correct service box. What happens?",
    options: [
      "Always a fault",
      "Replay as a let",
      "The rally continues if the serve was otherwise legal",
    ],
    answer: 2,
    explanation:
      "A serve may touch the net and continue if it crosses correctly and lands in the proper service court.",
  },
  {
    question: "At 20–20, a side wins the next rally. Is the game over?",
    options: ["Yes, because it reached 21", "No, it must lead by 2", "Only in a deciding game"],
    answer: 1,
    explanation:
      "At 20-all, the game continues until a side leads by two, unless the score reaches 29-all.",
  },
];

function RulesPage() {
  const [tab, setTab] = useState<"guide" | "checker" | "referee" | "quiz">("guide");
  const [search, setSearch] = useState("");
  const [scenarioIndex, setScenarioIndex] = useState(0);
  const [scenarioAnswer, setScenarioAnswer] = useState<number | null>(null);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizAnswer, setQuizAnswer] = useState<number | null>(null);
  const [quizScore, setQuizScore] = useState(0);

  const filteredRules = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return ruleItems;
    return ruleItems.filter((item) =>
      [item.label, item.title, item.text, ...item.tags].join(" ").toLowerCase().includes(query),
    );
  }, [search]);

  const selectTab = (next: typeof tab) => {
    setTab(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const scenario = scenarios[scenarioIndex];
  const quiz = scenarios[quizIndex];

  return (
    <div className="space-y-6">
      <header className="club-page-heading relative overflow-hidden rounded-3xl border border-primary/20 bg-card/70 p-6 shadow-[0_20px_80px_oklch(0.16_0.04_190/0.3)] sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-primary/15 blur-3xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="eyebrow">
              <BookOpen className="h-3.5 w-3.5" /> Court-side rules hub
            </p>
            <h1 className="mt-3 max-w-2xl font-display text-3xl font-bold tracking-tight sm:text-5xl">
              Know the call before it matters.
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-muted-foreground">
              Learn the rule, test the situation, and use the court-side tools to make the next call
              with confidence.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary">
            <ShieldCheck className="h-4 w-4" /> Ready for the next rally
          </div>
        </div>
      </header>

      <div className="grid gap-2 rounded-2xl border border-white/10 bg-card/50 p-2 sm:grid-cols-4">
        <TabButton
          active={tab === "guide"}
          icon={<BookOpen className="h-4 w-4" />}
          label="Rules guide"
          onClick={() => selectTab("guide")}
        />
        <TabButton
          active={tab === "checker"}
          icon={<Target className="h-4 w-4" />}
          label="Serve checker"
          onClick={() => selectTab("checker")}
        />
        <TabButton
          active={tab === "referee"}
          icon={<Gavel className="h-4 w-4" />}
          label="Referee mode"
          onClick={() => selectTab("referee")}
        />
        <TabButton
          active={tab === "quiz"}
          icon={<CircleHelp className="h-4 w-4" />}
          label="Practice quiz"
          onClick={() => selectTab("quiz")}
        />
      </div>

      {tab === "guide" && (
        <Guide filteredRules={filteredRules} search={search} setSearch={setSearch} />
      )}
      {tab === "checker" && <ServeChecker />}
      {tab === "referee" && <RefereeMode />}
      {tab === "quiz" && (
        <QuizMode
          quiz={quiz}
          quizIndex={quizIndex}
          quizAnswer={quizAnswer}
          quizScore={quizScore}
          setQuizAnswer={setQuizAnswer}
          setQuizIndex={setQuizIndex}
          setQuizScore={setQuizScore}
        />
      )}

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="bento-tile p-5 sm:p-6">
          <p className="eyebrow">
            <CircleHelp className="h-3.5 w-3.5" /> Scenario decision
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold">Was this legal?</h2>
          <p className="mt-3 text-sm leading-6 text-foreground">{scenario.question}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {scenario.options.map((option, index) => (
              <button
                key={option}
                onClick={() => setScenarioAnswer(index)}
                className={`rounded-xl border px-3 py-3 text-left text-xs font-semibold transition ${scenarioAnswer === index ? (index === scenario.answer ? "border-primary/50 bg-primary/10 text-primary" : "border-destructive/40 bg-destructive/10 text-destructive") : "border-white/10 bg-background/30 hover:border-primary/30"}`}
              >
                {option}
              </button>
            ))}
          </div>
          {scenarioAnswer !== null && (
            <div
              className={`mt-4 rounded-xl border p-3 text-xs leading-5 ${scenarioAnswer === scenario.answer ? "border-primary/20 bg-primary/5 text-primary" : "border-amber-400/20 bg-amber-400/5 text-foreground"}`}
            >
              <strong>{scenarioAnswer === scenario.answer ? "Correct. " : "Not quite. "}</strong>
              {scenario.explanation}
            </div>
          )}
          <button
            onClick={() => {
              setScenarioIndex((scenarioIndex + 1) % scenarios.length);
              setScenarioAnswer(null);
            }}
            className="mt-4 inline-flex items-center gap-2 text-xs font-semibold text-primary hover:underline"
          >
            Next scenario <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-6">
          <p className="eyebrow">
            <Video className="h-3.5 w-3.5" /> Video examples
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold">See the laws in motion.</h2>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            Use official training and laws resources for real examples of service faults, line
            calls, net contact, and tournament conduct.
          </p>
          <div className="mt-4 space-y-2">
            <ReferenceLink
              href="https://corporate.bwfbadminton.com/statutes/"
              label="BWF Laws and statutes"
            />
            <ReferenceLink
              href="https://usabadminton.org/athletes/juniors/junior-tournament-rules/"
              label="USAB junior tournament rules"
            />
          </div>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="bento-tile p-5 sm:p-6">
          <p className="eyebrow">Tournament mode</p>
          <h2 className="mt-1 font-display text-xl font-semibold">Match formats at a glance</h2>
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {PRESETS.map((preset) => (
              <div
                key={preset.id}
                className="rounded-xl border border-white/10 bg-background/30 p-3"
              >
                <div className="flex items-center justify-between text-sm font-semibold">
                  <span>{preset.label}</span>
                  <span className="text-primary">
                    {preset.bestOf === 1 ? "1 game" : `Best of ${preset.bestOf}`}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  First to {preset.target}
                  {preset.decidingPoint ? ", no deuce" : `, cap at ${preset.cap}`}
                </p>
              </div>
            ))}
          </div>
        </div>
        <div className="bento-tile p-5 sm:p-6">
          <p className="eyebrow">Glossary</p>
          <h2 className="mt-1 font-display text-xl font-semibold">Common court language</h2>
          <div className="mt-4 grid gap-x-5 gap-y-3 sm:grid-cols-2">
            {glossary.map(([term, definition]) => (
              <div key={term}>
                <strong className="text-xs text-foreground">{term}</strong>
                <p className="mt-1 text-[11px] leading-5 text-muted-foreground">{definition}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-card/40 px-4 py-3 text-[11px] text-muted-foreground">
        <span>
          Rules are a learning aid; tournament officials and current governing documents are
          authoritative.
        </span>
        <div className="flex gap-3">
          <a
            href="https://corporate.bwfbadminton.com/statutes/"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            BWF references <ExternalLink className="ml-1 inline h-3 w-3" />
          </a>
          <a
            href="https://usabadminton.org/about/governance/policies-procedures/"
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
          >
            USAB references <ExternalLink className="ml-1 inline h-3 w-3" />
          </a>
        </div>
      </footer>
    </div>
  );
}

function Guide({
  filteredRules,
  search,
  setSearch,
}: {
  filteredRules: RuleItem[];
  search: string;
  setSearch: (value: string) => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="eyebrow">
            <Sparkles className="h-3.5 w-3.5" /> Quick reference
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold">
            Core rules, without the rulebook wall.
          </h2>
        </div>
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rules or terms"
            className="w-full rounded-xl border border-white/10 bg-card/60 py-2.5 pl-9 pr-3 text-xs outline-none transition focus:border-primary sm:w-64"
          />
        </label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {filteredRules.map((rule) => (
          <RuleCard key={rule.label} rule={rule} />
        ))}
      </div>
      {filteredRules.length === 0 && (
        <div className="bento-tile p-8 text-center text-sm text-muted-foreground">
          No rules match “{search}”. Try serving, doubles, scoring, or faults.
        </div>
      )}
    </section>
  );
}

function RuleCard({ rule }: { rule: RuleItem }) {
  const Icon = rule.icon;
  return (
    <article className="bento-tile p-5 transition hover:-translate-y-0.5">
      <div className="mb-3 flex items-center gap-2 text-primary">
        <Icon className="h-5 w-5" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em]">{rule.label}</span>
      </div>
      <strong className="block text-lg font-semibold leading-snug">{rule.title}</strong>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{rule.text}</p>
      <div className="mt-4 flex flex-wrap gap-1.5">
        {rule.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full border border-white/10 px-2 py-1 text-[10px] text-muted-foreground"
          >
            {tag}
          </span>
        ))}
      </div>
    </article>
  );
}

function ServeChecker() {
  const [mode, setMode] = useState<GameMode>("singles");
  const [score, setScore] = useState(0);
  const [nearSide, setNearSide] = useState(true);
  const [landing, setLanding] = useState({ x: 0.72, y: 0.68 });
  const box = activeLandingBox(mode, true, nearSide, score);
  const isIn = inServiceCourt(landing.x, landing.y, mode, nearSide, score);
  const serverSide = correctServeSide(score);
  const targetSide = receiverCourt(score);
  // The box, marker and lines share one mapping from court units to the tile.
  const at = (value: number) => `${value * 86 + 7}%`;
  const updateLanding = (event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setLanding({
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    });
  };
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
      <div className="bento-tile p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="eyebrow">
              <Target className="h-3.5 w-3.5" /> Interactive court
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold">Serve checker</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Tap where the serve landed to check the active service box.
            </p>
          </div>
          <div className="flex rounded-xl border border-white/10 p-1">
            {(["singles", "doubles"] as GameMode[]).map((item) => (
              <button
                key={item}
                onClick={() => setMode(item)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${mode === item ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <button
          onClick={updateLanding}
          className="relative mx-auto mt-5 block aspect-[0.68] w-full max-w-sm overflow-hidden rounded-2xl border-2 border-primary/60 bg-[#062b38] shadow-[var(--shadow-glow)]"
          aria-label="Tap the court where the serve landed"
        >
          <div className="absolute inset-[7%] border border-primary/70" />
          <div className="absolute inset-x-[7%] top-1/2 border-t border-primary/70" />
          <div className="absolute inset-y-[7%] left-1/2 border-l border-primary/70" />
          {[COURT.shortServiceY, 1 - COURT.shortServiceY].map((y) => (
            <div
              key={y}
              className="absolute inset-x-[7%] border-t border-primary/30"
              style={{ top: at(y) }}
            />
          ))}
          {mode === "singles" &&
            [COURT.singlesSideline, 1 - COURT.singlesSideline].map((x) => (
              <div
                key={x}
                className="absolute inset-y-[7%] border-l border-primary/30"
                style={{ left: at(x) }}
              />
            ))}
          {mode === "doubles" &&
            [COURT.doublesLongServiceY, 1 - COURT.doublesLongServiceY].map((y) => (
              <div
                key={y}
                className="absolute inset-x-[7%] border-t border-dashed border-primary/30"
                style={{ top: at(y) }}
              />
            ))}
          <div
            className="absolute rounded-lg border-2 border-primary bg-primary/15 shadow-[0_0_25px_oklch(0.82_0.17_165/0.45)] transition-all duration-300"
            style={{
              left: at(box.xMin),
              top: at(box.yMin),
              width: `${(box.xMax - box.xMin) * 86}%`,
              height: `${(box.yMax - box.yMin) * 86}%`,
            }}
          />
          <div
            className={`absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-lg transition-all duration-300 ${isIn ? "bg-primary" : "bg-destructive"}`}
            style={{ left: at(landing.x), top: at(landing.y) }}
          />
          <span className="absolute bottom-2 left-1/2 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/80">
            Receiver's {targetSide} court
          </span>
        </button>
      </div>
      <div className="bento-tile p-5 sm:p-6">
        <p className="eyebrow">Live decision</p>
        <div
          className={`mt-3 rounded-2xl border p-4 ${isIn ? "border-primary/30 bg-primary/10" : "border-destructive/30 bg-destructive/10"}`}
        >
          <p
            className={`font-display text-2xl font-bold ${isIn ? "text-primary" : "text-destructive"}`}
          >
            {isIn ? "LEGAL SERVE" : "SERVICE FAULT"}
          </p>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">
            {isIn
              ? `Landing is inside the receiver's ${targetSide} service court.`
              : `Move the landing into the receiver's ${targetSide} service court.`}
          </p>
        </div>
        <div className="mt-5 space-y-3">
          <label className="block text-xs font-semibold">
            Server's score
            <input
              type="number"
              min="0"
              max="99"
              value={score}
              onChange={(e) => setScore(Math.max(0, Number(e.target.value) || 0))}
              className="mt-1 w-full rounded-xl border border-white/10 bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
          </label>
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded-xl border border-white/10 bg-background/30 p-3">
              Serve from
              <strong className="mt-1 block font-display text-lg capitalize text-primary">
                {serverSide}
              </strong>
            </div>
            <div className="rounded-xl border border-white/10 bg-background/30 p-3">
              Receiver's court
              <strong className="mt-1 block font-display text-lg capitalize text-primary">
                {targetSide}
              </strong>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-white/10 bg-background/30 p-3 text-xs">
            <span>{nearSide ? "Server is on near side" : "Server is on far side"}</span>
            <button
              onClick={() => setNearSide((value) => !value)}
              className="rounded-lg border border-primary/20 px-2.5 py-1.5 font-semibold text-primary"
            >
              Flip court
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function RefereeMode() {
  const [call, setCall] = useState("Ready for the next rally.");
  const calls = [
    { label: "Let", copy: "Replay the rally; score stays the same.", icon: RotateCcw },
    {
      label: "Fault",
      copy: "Rally ends and the opponent receives the point.",
      icon: AlertTriangle,
    },
    { label: "Challenge", copy: "Pause play and review the line call.", icon: Search },
    { label: "Interval", copy: "Start the scheduled break in play.", icon: Clock3 },
    {
      label: "Service fault",
      copy: "Wrong court, illegal action, or missed service box.",
      icon: Gavel,
    },
    {
      label: "In / out",
      copy: "Record the landing call and continue the match.",
      icon: CheckCircle2,
    },
  ];
  return (
    <section className="bento-tile p-5 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">
            <Gavel className="h-3.5 w-3.5" /> Court-side official
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold">Referee mode</h2>
          <p className="mt-1 max-w-xl text-xs leading-5 text-muted-foreground">
            Keep calls visible and consistent while someone else runs the scoreboard.
          </p>
        </div>
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-semibold text-primary">
          {call}
        </div>
      </div>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {calls.map(({ label, copy, icon: Icon }) => (
          <button
            key={label}
            onClick={() => setCall(`${label}: ${copy}`)}
            className="group rounded-2xl border border-white/10 bg-background/30 p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/35 hover:bg-primary/5"
          >
            <Icon className="h-5 w-5 text-primary transition group-hover:scale-110" />
            <strong className="mt-3 block text-sm">{label}</strong>
            <span className="mt-1 block text-xs leading-5 text-muted-foreground">{copy}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function QuizMode({
  quiz,
  quizIndex,
  quizAnswer,
  quizScore,
  setQuizAnswer,
  setQuizIndex,
  setQuizScore,
}: {
  quiz: Scenario;
  quizIndex: number;
  quizAnswer: number | null;
  quizScore: number;
  setQuizAnswer: (value: number | null) => void;
  setQuizIndex: (value: number) => void;
  setQuizScore: (value: number) => void;
}) {
  const choose = (index: number) => {
    if (quizAnswer !== null) return;
    setQuizAnswer(index);
    if (index === quiz.answer) setQuizScore(quizScore + 1);
  };
  const next = () => {
    setQuizIndex((quizIndex + 1) % scenarios.length);
    setQuizAnswer(null);
  };
  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_0.6fr]">
      <div className="bento-tile p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="eyebrow">
              <Sparkles className="h-3.5 w-3.5" /> Rules practice
            </p>
            <h2 className="mt-1 font-display text-xl font-semibold">
              Build your referee instincts.
            </h2>
          </div>
          <span className="text-xs font-semibold text-primary">
            {quizIndex + 1} / {scenarios.length}
          </span>
        </div>
        <p className="mt-5 text-sm leading-6">{quiz.question}</p>
        <div className="mt-4 grid gap-2">
          {quiz.options.map((option, index) => (
            <button
              key={option}
              onClick={() => choose(index)}
              className={`rounded-xl border px-3 py-3 text-left text-xs font-semibold transition ${quizAnswer === index ? (index === quiz.answer ? "border-primary/50 bg-primary/10 text-primary" : "border-destructive/40 bg-destructive/10 text-destructive") : "border-white/10 bg-background/30 hover:border-primary/30"}`}
            >
              {option}
            </button>
          ))}
        </div>
        {quizAnswer !== null && (
          <div className="mt-4 rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">
            {quiz.explanation}
          </div>
        )}
        <button
          disabled={quizAnswer === null}
          onClick={next}
          className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"
        >
          Next question <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5 sm:p-6">
        <p className="eyebrow">Progress</p>
        <p className="mt-2 font-display text-4xl font-bold text-primary">{quizScore}</p>
        <p className="mt-1 text-xs text-muted-foreground">correct answers</p>
        {quizScore >= 3 ? (
          <div className="mt-5 flex items-center gap-2 rounded-xl border border-primary/20 bg-background/30 p-3 text-xs font-semibold text-primary">
            <Check className="h-4 w-4" /> Rules Ready badge unlocked
          </div>
        ) : (
          <p className="mt-5 text-xs leading-5 text-muted-foreground">
            Answer three questions correctly to unlock the Rules Ready badge.
          </p>
        )}
      </div>
    </section>
  );
}

function TabButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-xs font-semibold transition ${active ? "bg-primary text-primary-foreground shadow-[var(--shadow-glow)]" : "text-muted-foreground hover:bg-background/50 hover:text-foreground"}`}
    >
      {icon}
      {label}
    </button>
  );
}

function ReferenceLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="flex items-center justify-between rounded-xl border border-white/10 bg-background/30 px-3 py-2.5 text-xs font-semibold transition hover:border-primary/30 hover:bg-primary/5"
    >
      {label}
      <ExternalLink className="h-3.5 w-3.5 text-primary" />
    </a>
  );
}
