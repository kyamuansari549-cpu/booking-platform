import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { EventForm } from "./event-form";

export default async function NewEventPage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect(`/api/auth/signin?callbackUrl=${encodeURIComponent("/organizer/events/new")}`);
  }
  if (session.user.role === "USER") redirect("/organizer");

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">New event</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Describe the event and design the seat map. It will be saved as a draft.
      </p>
      <EventForm />
    </div>
  );
}
