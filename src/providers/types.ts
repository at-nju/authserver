export type ProviderIdentity = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
};

export type RegistrationPolicy = "allow" | "deny" | {
  mode: "email-domain";
  domains: readonly string[];
};

export function registrationAllowed(policy: RegistrationPolicy, email: string) {
  if (policy === "allow") return true;
  if (policy === "deny") return false;
  const domain = email.slice(email.lastIndexOf("@") + 1).toLowerCase();
  return policy.domains.includes(domain);
}
