const consolePath = "/console";

export function safeReturn(value?: string): string {
  return value === consolePath ? value : consolePath;
}

export function continueTo(oauthQuery?: string, returnTo?: string): string {
  return oauthQuery ? `/oauth2/authorize?${oauthQuery}` : safeReturn(returnTo);
}

export function onboardingTo(oauthQuery?: string, returnTo?: string): string {
  const query = new URLSearchParams(
    oauthQuery ? { oauth_query: oauthQuery } : { return_to: safeReturn(returnTo) },
  );
  return `/onboarding?${query}`;
}

export function afterLogin(completed: boolean | undefined, oauthQuery?: string, returnTo?: string) {
  return completed ? continueTo(oauthQuery, returnTo) : onboardingTo(oauthQuery, returnTo);
}

export function afterOnboarding(search: string): string {
  const query = new URLSearchParams(search);
  return continueTo(query.get("oauth_query") ?? undefined, query.get("return_to") ?? undefined);
}
