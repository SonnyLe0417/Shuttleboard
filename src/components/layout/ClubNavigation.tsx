import { Link, useLocation } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Home, Plus, Video, MoreHorizontal, X } from "lucide-react";
import { ClubBrand } from "./ClubBrand";

const groups = [
  {
    title: "Your game",
    links: [
      ["History", "/history"],
      ["Progress", "/progress"],
    ],
  },
  { title: "Your club", links: [["Community", "/social"]] },
  {
    title: "Tools & learning",
    links: [
      ["AI Referee", "/ai"],
      ["Rules", "/rules"],
      ["Junior Rankings", "/junior-rankings"],
    ],
  },
  {
    title: "Account",
    links: [
      ["Profile", "/profile"],
      ["Settings", "/settings"],
    ],
  },
];

export default function ClubNavigation({ signedIn }: { signedIn: boolean }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false);
    };
    desktop.addEventListener("change", closeOnDesktop);
    return () => desktop.removeEventListener("change", closeOnDesktop);
  }, []);
  const primary = [
    {
      label: "Home",
      to: signedIn ? "/dashboard" : "/",
      icon: Home,
      active: pathname === "/dashboard",
    },
    {
      label: "Play",
      to: signedIn ? "/match-lobby" : "/scoreboard",
      icon: Plus,
      active: ["/scoreboard", "/match-lobby"].includes(pathname),
    },
    { label: "Analyze", to: "/video", icon: Video, active: pathname === "/video" },
  ];
  function destinations() {
    return groups.map((group) => (
      <section key={group.title}>
        <h2>{group.title}</h2>
        {group.links.map(([label, to]) => (
          <Link
            key={to}
            to={to}
            aria-current={pathname === to ? "page" : undefined}
            onClick={() => setOpen(false)}
          >
            {label}
          </Link>
        ))}
      </section>
    ));
  }
  return (
    <>
      <aside className="club-sidebar">
        <ClubBrand to={signedIn ? "/dashboard" : "/"} />
        <p className="club-nav-caption">Your side of the court</p>
        <nav aria-label="Main navigation">
          {primary.map(({ label, to, icon: Icon, active }) => (
            <Link key={label} to={to} aria-current={active ? "page" : undefined}>
              <Icon size={20} />
              {label}
            </Link>
          ))}
        </nav>
        <div className="club-secondary">{destinations()}</div>
        {!signedIn && (
          <Link to="/auth" className="button-primary">
            Sign in
          </Link>
        )}
      </aside>
      <header className="club-mobile-header">
        <ClubBrand to={signedIn ? "/dashboard" : "/"} />
        <Link to={signedIn ? "/profile" : "/auth"}>{signedIn ? "Your profile" : "Sign in"}</Link>
      </header>
      <nav className="club-bottom-nav" aria-label="Phone navigation">
        {primary.map(({ label, to, icon: Icon, active }) => (
          <Link key={label} to={to} aria-current={active ? "page" : undefined}>
            <Icon size={21} />
            <span>{label}</span>
          </Link>
        ))}
        <button
          ref={more}
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <MoreHorizontal size={21} />
          <span>More</span>
        </button>
      </nav>
      <dialog
        ref={dialog}
        className="club-more"
        aria-labelledby="club-more-title"
        onCancel={() => setOpen(false)}
        onClose={() => {
          setOpen(false);
          more.current?.focus();
        }}
      >
        <header>
          <h2 id="club-more-title">More from ShuttleBoard</h2>
          <button aria-label="Close menu" onClick={() => setOpen(false)}>
            <X size={22} />
          </button>
        </header>
        <div className="club-secondary">{destinations()}</div>
      </dialog>
    </>
  );
}
