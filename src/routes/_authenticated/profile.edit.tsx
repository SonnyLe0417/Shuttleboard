import { createFileRoute } from "@tanstack/react-router";
import { ProfilePage } from "@/components/profile/ProfilePage";

export const Route = createFileRoute("/_authenticated/profile/edit")({
  head: () => ({ meta: [{ title: "Edit profile · ShuttleBoard" }] }),
  component: EditProfilePage,
});

function EditProfilePage() {
  return <ProfilePage forceEditing />;
}
