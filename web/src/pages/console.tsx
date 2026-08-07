import { useEffect, useState } from "preact/hooks";
import { request, useSession } from "../api";
import { Layout, tabButtonClass } from "../components";
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

  if (!session) return <Layout title="控制台"><p>加载中</p></Layout>;
  return <Layout title="控制台" wide>
    <div class="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div class="flex gap-1 rounded-lg border border-neutral-300 bg-neutral-200/60 p-1"
        role="tablist" aria-label="控制台">
        <button type="button" role="tab" aria-selected={tab === "profile"}
          class={tabButtonClass(tab === "profile")}
          onClick={() => { location.hash = "profile"; }}>资料</button>
        <button type="button" role="tab" aria-selected={tab === "oidc"}
          class={tabButtonClass(tab === "oidc")}
          onClick={() => { location.hash = "oidc"; }}>OIDC 应用</button>
      </div>
      <button class="text-blue-500 hover:text-blue-700" onClick={logout}>退出</button>
    </div>
    {tab === "profile"
      ? <ProfileTab session={session} onChanged={() => setRevision((value) => value + 1)} />
      : <OidcTab />}
  </Layout>;
}
