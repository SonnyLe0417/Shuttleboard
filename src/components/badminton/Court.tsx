import { useRef } from "react";
import { type GameMode, COURT } from "@/lib/badminton";

interface CourtProps {
  mode: GameMode;
  onTap: (x: number, y: number) => void;
  landing?: { x: number; y: number } | null;
  isIn?: boolean | null;
}

export function Court({ mode, onTap, landing, isIn }: CourtProps) {
  const ref = useRef<HTMLDivElement>(null);

  const handlePointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    onTap(x, y);
  };

  return (
    <div className="relative w-full overflow-hidden rounded-2xl bg-court shadow-xl">
      <div
        ref={ref}
        className="relative aspect-[610/1340] w-full cursor-crosshair touch-none"
        onPointerDown={handlePointer}
        onPointerMove={(e) => e.buttons === 1 && handlePointer(e)}
        role="button"
        tabIndex={0}
        aria-label="Tap the court where the shuttle landed"
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            onTap(0.5, 0.5);
          }
        }}
      >
        {/* Boundary lines */}
        <CourtLine horizontal={0} />
        <CourtLine horizontal={1} />
        <CourtLine vertical={0} />
        <CourtLine vertical={1} />

        {/* Singles sidelines */}
        <CourtLine vertical={COURT.singlesSideline} />
        <CourtLine vertical={1 - COURT.singlesSideline} />

        {/* Center long service line */}
        <CourtLine vertical={COURT.center} />

        {/* Short service lines */}
        <CourtLine horizontal={COURT.shortServiceY} />
        <CourtLine horizontal={1 - COURT.shortServiceY} />

        {/* Doubles long service lines */}
        {mode === "doubles" && (
          <>
            <CourtLine horizontal={COURT.doublesLongServiceY} />
            <CourtLine horizontal={1 - COURT.doublesLongServiceY} />
          </>
        )}

        {/* Net */}
        <div
          className="absolute left-0 right-0 h-1 -translate-y-1/2 bg-court-line/80"
          style={{ top: `${COURT.center * 100}%` }}
        />
        <div
          className="absolute left-0 right-0 h-1.5 -translate-y-1/2 border-y-2 border-dashed border-court-line/60"
          style={{ top: `${COURT.center * 100}%` }}
        />

        {/* Landing marker */}
        {landing && (
          <div
            className="absolute court-marker"
            style={{
              left: `${landing.x * 100}%`,
              top: `${landing.y * 100}%`,
              backgroundColor: isIn ? "var(--color-in)" : "var(--color-out)",
            }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}

function CourtLine({ horizontal, vertical }: { horizontal?: number; vertical?: number }) {
  const style =
    horizontal !== undefined
      ? { top: `${horizontal * 100}%`, left: 0, right: 0, height: "2px" }
      : { left: `${vertical! * 100}%`, top: 0, bottom: 0, width: "2px" };

  return <div className="absolute bg-court-line" style={style} aria-hidden="true" />;
}
