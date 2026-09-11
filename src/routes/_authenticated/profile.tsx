import { createFileRoute } from "@tanstack/react-router";
import { ProfilePage } from "@/components/profile/ProfilePage";

export const Route = createFileRoute("/_authenticated/profile")({
  head: () => ({ meta: [{ title: "Profile · ShuttleBoard" }] }),
  component: ProfilePage,
});
