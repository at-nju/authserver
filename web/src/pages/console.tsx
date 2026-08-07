import { useEffect, useState } from "preact/hooks";
import { request, useSession } from "../api";
import { OidcTab } from "./console/oidc";
import { ProfileTab } from "./console/profile";

export default function Console() {
  const [revision, setRevision] = useState(0);
  const session = useSession("/login?return_to=/console", revision);
  const [tab, setTab] = useState<"profile" | "oidc">(
    () => (location.hash === "#oidc" ? "oidc" : "profile"),
  );

  useEffect(() => {
    const onHashChange = () => setTab(location.hash === "#oidc" ? "oidc" : "profile");
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  async function logout() {
    await request("/sign-out", {});
    location.replace("/login");
  }

  if (!session) {
    return <div class="flex min-h-[100dvh] items-center justify-center">
      <p class="text-sm text-stone-400">加载中</p>
    </div>;
  }
  return <div class="min-h-[100dvh]">
    <header class="sticky top-0 z-40 border-b border-stone-200/70 bg-white/85 backdrop-blur">
      <div class="mx-auto flex h-14 w-full max-w-5xl items-center justify-between gap-4 px-4">
        <div class="flex min-w-0 items-center gap-6">
          <span class="whitespace-nowrap text-sm font-semibold tracking-tight text-stone-900">{__APP_NAME__}</span>
          <nav class="flex items-center gap-1" role="tablist" aria-label="控制台">
            <button type="button" role="tab" aria-selected={tab === "profile"}
              class={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === "profile"
                ? "text-stone-950"
                : "text-stone-500 hover:text-stone-800"}`}
              onClick={() => { location.hash = "profile"; }}>资料</button>
            <button type="button" role="tab" aria-selected={tab === "oidc"}
              class={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${tab === "oidc"
                ? "text-stone-950"
                : "text-stone-500 hover:text-stone-800"}`}
              onClick={() => { location.hash = "oidc"; }}>OIDC 应用</button>
          </nav>
        </div>
        <button class="text-sm text-stone-500 transition-colors hover:text-stone-900"
          onClick={logout}>退出</button>
      </div>
    </header>
    <main class="mx-auto w-full max-w-5xl px-4 py-8">
      {tab === "profile"
        ? <ProfileTab session={session} onChanged={() => setRevision((value) => value + 1)} />
        : <OidcTab />}
    </main>
  </div>;
}
