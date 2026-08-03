import { APIError } from "better-auth/api";
import { emailOTP } from "better-auth/plugins";
import { config, type Env } from "../../config";
import { registrationAllowed } from "./types";

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function emailRegistrationAllowed(email: string) {
  return registrationAllowed(config.providers.email.registration, normalizeEmail(email));
}

async function sendOtp(env: Pick<Env, "SMTP_PASSWORD">, email: string, otp: string) {
  const provider = config.providers.email;
  const { WorkerMailer } = await import("worker-mailer");
  await WorkerMailer.send(
    {
      host: provider.smtp.host,
      port: provider.smtp.port,
      secure: provider.smtp.secure,
      startTls: !provider.smtp.secure,
      authType: "login",
      credentials: { username: provider.smtp.username, password: env.SMTP_PASSWORD },
    },
    {
      from: { name: config.appName, email: provider.smtp.from },
      to: email,
      subject: provider.subject,
      text: provider.text(otp),
    },
  );
}

export function createEmailProvider(env: Pick<Env, "SMTP_PASSWORD">) {
  const provider = config.providers.email;
  return emailOTP({
    disableSignUp: false,
    otpLength: provider.otpLength,
    expiresIn: provider.otpTtlSeconds,
    storeOTP: "hashed",
    changeEmail: { enabled: true, verifyCurrentEmail: false },
    sendVerificationOTP: async ({ email, otp, type }) => {
      if (type === "sign-in" && !emailRegistrationAllowed(email)) {
        throw new APIError("FORBIDDEN", { message: "仅支持南京大学邮箱" });
      }
      await sendOtp(env, normalizeEmail(email), otp);
    },
  });
}
