import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Reset password · ShuttleBoard" },
      { name: "description", content: "Set a new password for your ShuttleBoard account." },
    ],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Supabase auto-handles the recovery token in the URL hash and fires a
    // PASSWORD_RECOVERY event with a temporary session.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) return toast.error("Password must be at least 6 characters");
    if (password !== confirm) return toast.error("Passwords don't match");
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      toast.success("Password updated");
      navigate({ to: "/profile" });
    } catch (err: any) {
      toast.error(err.message ?? "Could not update password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="text-center">
        <h1 className="font-display text-3xl font-bold">Set a new password</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {ready ? "Choose a new password for your account." : "Verifying your reset link…"}
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-card/60 p-6 shadow-lg backdrop-blur">
        {!ready ? (
          <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Waiting for recovery session…
          </div>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <input
              type="password"
              required
              minLength={6}
              placeholder="New password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              type="password"
              required
              minLength={6}
              placeholder="Confirm new password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition hover:opacity-90 disabled:opacity-50"
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              Update password
            </button>
          </form>
        )}
      </div>

      <div className="text-center text-xs text-muted-foreground">
        <Link to="/auth" className="hover:text-foreground">
          ← Back to sign in
        </Link>
      </div>
    </div>
  );
}
