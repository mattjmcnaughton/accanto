import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  return (
    <main className="mx-auto min-h-screen max-w-4xl px-6 py-16 text-slate-800">
      <p className="text-lg font-semibold">Accanto</p>
      <h1 className="mt-20 max-w-2xl text-4xl font-medium leading-tight sm:text-5xl">
        Money for the life you want.
      </h1>
      <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-600">
        A financial companion for conscious spending, meaningful goals, and more choice for your
        future.
      </p>
      <p className="mt-12 border-t border-slate-200 pt-6 text-sm text-slate-500">
        Accanto is taking shape. Plan creation, rich-life progress, and the AI companion are coming
        next.
      </p>
    </main>
  );
}
