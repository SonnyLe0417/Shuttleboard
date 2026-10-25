export function SessionRecovery({ inline = false }: { inline?: boolean }) {
  return (
    <div
      role="alert"
      className={inline ? "mx-4 my-3 rounded-lg border p-4" : "app-state text-center"}
    >
      <p>We couldn’t check your sign-in status. Reload to try again.</p>
      <button
        type="button"
        className="button-primary mt-3"
        onClick={() => window.location.reload()}
      >
        Reload
      </button>
    </div>
  );
}
