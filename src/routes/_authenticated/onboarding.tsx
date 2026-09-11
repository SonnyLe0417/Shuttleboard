import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  ArrowRight,
  ArrowLeft,
  Check,
  Loader2,
  UserRound,
  Sliders,
  Sparkles,
  Trophy,
} from "lucide-react";
import { completeOnboarding, getMyProfile, getMyPreferences } from "@/lib/matches.functions";
import { PRESETS, type PresetId } from "@/lib/badminton-rules";

export const Route = createFileRoute("/_authenticated/onboarding")({
  head: () => ({ meta: [{ title: "Welcome · ShuttleBoard" }] }),
  component: OnboardingWizard,
});

const STEPS = ["Identity", "Match defaults", "Ready"] as const;

const FOCUS_OPTIONS = [
  "Consistency",
  "Match confidence",
  "Singles",
  "Doubles",
  "Reflection",
] as const;

function OnboardingWizard() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const fetchProfile = useServerFn(getMyProfile);
  const fetchPrefs = useServerFn(getMyPreferences);
  const save = useServerFn(completeOnboarding);

  const { data: profile } = useQuery({
    queryKey: ["me", "profile"],
    queryFn: () => fetchProfile(),
  });
  const { data: prefs } = useQuery({
    queryKey: ["me", "preferences"],
    queryFn: () => fetchPrefs(),
  });

  const [step, setStep] = useState(0);
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [location, setLocation] = useState("");
  const [playingHand, setPlayingHand] = useState<"right" | "left" | "ambi" | "">("");
  const [gender, setGender] = useState<"male" | "female" | "">("");
  const [favoriteRacket, setFavoriteRacket] = useState("");
  const [homeCourt, setHomeCourt] = useState("");
  const [primaryFocus, setPrimaryFocus] = useState<(typeof FOCUS_OPTIONS)[number]>("Consistency");

  const [preset, setPreset] = useState<PresetId>("21");
  const [mode, setMode] = useState<"singles" | "doubles">("singles");
  const [courtColor, setCourtColor] = useState<string>("#1b4332");

  const [saving, setSaving] = useState(false);
  const [referralCode, setReferralCode] = useState<string | null>(null);

  useEffect(() => {
    const code =
      new URLSearchParams(window.location.search).get("ref") ||
      window.localStorage.getItem("shuttleboard.referral");
    if (code) setReferralCode(code);
  }, []);

  useEffect(() => {
    if (profile) {
      setHandle(profile.handle ?? "");
      setDisplayName(profile.display_name ?? "");
      setLocation((profile as any).location ?? "");
      setPlayingHand((((profile as any).playing_hand ?? "") as any) || "");
      setGender((((profile as any).gender ?? "") as any) || "");
      setFavoriteRacket((profile as any).favorite_racket ?? "");
      setHomeCourt((profile as any).home_court ?? "");
    }
  }, [profile]);

  useEffect(() => {
    if (prefs?.match_defaults) {
      const d: any = prefs.match_defaults;
      if (d.mode) setMode(d.mode);
      if (d.court_color) setCourtColor(d.court_color);
    }
  }, [prefs]);

  const identityValid =
    handle.length >= 2 && /^[a-z0-9_]+$/.test(handle) && displayName.trim().length >= 1;

  function next() {
    if (step === 0 && !identityValid) {
      toast.error("Add a valid handle and display name to continue");
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }

  async function finish() {
    if (!identityValid) {
      setStep(0);
      return;
    }
    setSaving(true);
    try {
      const rules = PRESETS.find((p) => p.id === preset) ?? PRESETS[0];
      await save({
        data: {
          handle: handle.toLowerCase(),
          display_name: displayName.trim(),
          primary_focus: primaryFocus,
          location: location || null,
          playing_hand: playingHand || null,
          gender: gender || null,
          favorite_racket: favoriteRacket || null,
          home_court: homeCourt || null,
          match_defaults: {
            mode,
            format: rules.label,
            points_to_win: rules.target,
            best_of: rules.bestOf,
            court_color: courtColor,
          },
          referral_code: referralCode,
        },
      });
      window.localStorage.removeItem("shuttleboard.referral");
      await queryClient.invalidateQueries({ queryKey: ["auth", "onboarding"] });
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      toast.success("You're all set — welcome!");
      router.navigate({ to: "/dashboard", replace: true });
    } catch (err: any) {
      toast.error(err.message ?? "Couldn't save your setup");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[80vh] w-full max-w-xl flex-col justify-center px-4 py-10">
      <div className="mb-6 flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-primary" />
        <span className="text-xs uppercase tracking-widest text-muted-foreground">
          Set up your player profile
        </span>
      </div>

      <Stepper current={step} />

      <div className="mt-6 rounded-2xl border border-white/10 bg-card/60 p-6 backdrop-blur">
        {step === 0 && (
          <Section icon={<UserRound className="h-4 w-4 text-primary" />} title="Who's playing?">
            <Field label="Handle" hint="lowercase letters, numbers, underscores">
              <div className="flex items-center rounded-lg border border-white/10 bg-background">
                <span className="pl-3 text-sm text-muted-foreground">@</span>
                <input
                  autoFocus
                  value={handle}
                  onChange={(e) => setHandle(e.target.value.toLowerCase())}
                  minLength={2}
                  maxLength={24}
                  pattern="[a-z0-9_]+"
                  className="w-full bg-transparent px-2 py-2 text-sm outline-none"
                />
              </div>
            </Field>
            <Field label="Display name">
              <TextInput value={displayName} onChange={setDisplayName} maxLength={60} />
            </Field>
            <div className="hidden">
              <Field label="Location" hint="optional">
                <TextInput
                  value={location}
                  onChange={setLocation}
                  maxLength={80}
                  placeholder="Copenhagen, DK"
                />
              </Field>
            </div>
            <Field label="Playing hand">
              <div className="flex gap-2">
                {(["right", "left", "ambi"] as const).map((h) => (
                  <Chip
                    key={h}
                    active={playingHand === h}
                    onClick={() => setPlayingHand(playingHand === h ? "" : h)}
                  >
                    {h === "ambi" ? "Ambi" : h[0].toUpperCase() + h.slice(1)}
                  </Chip>
                ))}
              </div>
            </Field>
            <div className="hidden">
              <Field label="Gender" hint="used for eligible junior divisions">
                <div className="flex gap-2">
                  {(["male", "female"] as const).map((value) => (
                    <Chip
                      key={value}
                      active={gender === value}
                      onClick={() => setGender(gender === value ? "" : value)}
                    >
                      {value[0].toUpperCase() + value.slice(1)}
                    </Chip>
                  ))}
                </div>
              </Field>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Favorite racket" hint="optional">
                  <TextInput
                    value={favoriteRacket}
                    onChange={setFavoriteRacket}
                    placeholder="Yonex Astrox 88D"
                  />
                </Field>
                <Field label="Home court" hint="optional">
                  <TextInput
                    value={homeCourt}
                    onChange={setHomeCourt}
                    placeholder="Nørrebrohallen"
                  />
                </Field>
              </div>
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              You can add location, racket, home court, and other profile details later.
            </p>
          </Section>
        )}

        {step === 1 && (
          <Section
            icon={<Sliders className="h-4 w-4 text-primary" />}
            title="How do you like to play?"
          >
            <Field label="Preferred format">
              <div className="flex gap-2">
                <Chip active={mode === "singles"} onClick={() => setMode("singles")}>
                  Singles
                </Chip>
                <Chip active={mode === "doubles"} onClick={() => setMode("doubles")}>
                  Doubles
                </Chip>
              </div>
            </Field>
            <Field label="What do you want to improve first?">
              <div className="flex flex-wrap gap-2">
                {FOCUS_OPTIONS.map((focus) => (
                  <Chip
                    key={focus}
                    active={primaryFocus === focus}
                    onClick={() => setPrimaryFocus(focus)}
                  >
                    {focus}
                  </Chip>
                ))}
              </div>
            </Field>
          </Section>
        )}

        {step === 2 && (
          <Section icon={<Trophy className="h-4 w-4 text-primary" />} title="Ready to play">
            <div className="rounded-xl border border-white/10 bg-background/60 p-4 text-sm">
              <p className="text-muted-foreground">Playing as</p>
              <p className="mt-1 text-lg font-semibold">{displayName || handle}</p>
              <p className="text-xs text-muted-foreground">@{handle}</p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Summary label="Format" value={PRESETS.find((p) => p.id === preset)?.label ?? "—"} />
              <Summary label="Mode" value={mode === "singles" ? "Singles" : "Doubles"} />
              <Summary
                label="Playing hand"
                value={playingHand ? playingHand[0].toUpperCase() + playingHand.slice(1) : "—"}
              />
              <Summary label="Focus" value={primaryFocus} />
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                className="h-3 w-3 rounded-full border border-white/20"
                style={{ backgroundColor: courtColor }}
              />
              Court palette locked in — you can tweak everything later in your profile.
            </div>
          </Section>
        )}

        <div className="mt-6 flex items-center justify-between">
          <button
            type="button"
            onClick={back}
            disabled={step === 0 || saving}
            className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-40"
          >
            <ArrowLeft className="h-4 w-4" /> Back
          </button>

          {step < STEPS.length - 1 ? (
            <button
              type="button"
              onClick={next}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Continue <ArrowRight className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="button"
              onClick={finish}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              {saving ? "Saving…" : "Enter the app"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((label, i) => {
        const state = i < current ? "done" : i === current ? "active" : "todo";
        return (
          <li key={label} className="flex flex-1 items-center gap-2">
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-semibold ${
                state === "done"
                  ? "border-primary bg-primary text-primary-foreground"
                  : state === "active"
                    ? "border-primary text-primary"
                    : "border-white/15 text-muted-foreground"
              }`}
            >
              {state === "done" ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span
              className={`text-xs ${
                state === "todo" ? "text-muted-foreground" : "text-foreground"
              }`}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px flex-1 bg-white/10" />}
          </li>
        );
      })}
    </ol>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="font-display text-lg font-semibold">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between text-xs font-medium text-muted-foreground">
        <span>{label}</span>
        {hint ? <span className="text-[10px] uppercase tracking-wider">{hint}</span> : null}
      </span>
      {children}
    </label>
  );
}

function TextInput({
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  maxLength?: number;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      maxLength={maxLength}
      className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
    />
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs transition ${
        active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-white/10 text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-background/60 p-3">
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-medium">{value}</p>
    </div>
  );
}
