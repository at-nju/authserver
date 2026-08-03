export { createDiscourseProvider } from "./discourse";
export { createEmailProvider, emailRegistrationAllowed, normalizeEmail } from "./email";
export { ensureEmailAccount, resolveIdentity, type ExternalIdentity } from "./identity";
export { createOidcProvider } from "./oidc";
export { authenticateSeaTableToken } from "./seatable";
export { registrationAllowed, type ProviderIdentity, type RegistrationPolicy } from "./types";
