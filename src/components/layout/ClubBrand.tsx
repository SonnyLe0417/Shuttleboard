import { Link } from "@tanstack/react-router";

export function ClubBrand({ to = "/" }: { to?: string }) {
  return (
    <Link to={to} className="club-brand" aria-label="ShuttleBoard home">
      <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <path
          d="M8 7 16 32H32L40 7 29 11 24 5 19 11Z M19 11 21 32M29 11 27 32M10 14 17 18M38 14 31 18M16 32H32V35A8 8 0 0 1 16 35Z"
          stroke="currentColor"
          strokeWidth="2.8"
          strokeLinejoin="round"
        />
      </svg>
      <span>
        ShuttleBoard<span className="text-primary">.</span>
      </span>
    </Link>
  );
}
