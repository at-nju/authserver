export type Env = {
  BETTER_AUTH_SECRET: string;
  SEATABLE_API_TOKEN: string;
  SMTP_PASSWORD: string;
};

export const config = {
  appName: "NJU Auth",

  auth: {
    basePath: "/",
    sessionTtlSeconds: 7 * 24 * 60 * 60,
  },

  seatable: {
    baseUrl: "https://table.nju.edu.cn",
    tableName: "Table1",
    idColumn: "ID",
    tokenColumn: "Token",
  },

  user: {
    defaultEmail: (id: string) => `${id}@smail.nju.edu.cn`,
  },

  email: {
    otpLength: 6,
    otpTtlSeconds: 10 * 60,
    subject: "NJU Auth 邮箱验证码",
    text: (otp: string) => `你的验证码是 ${otp}，10 分钟内有效。`,
  },

  smtp: {
    host: "smtp.feishu.cn",
    port: 465,
    secure: true,
    username: "noreply@nju.at",
    from: "noreply@nju.at",
  },

  oidc: {
    scopes: ["openid", "profile", "email"],
    authorizationCodeTtlSeconds: 10 * 60,
    accessTokenTtlSeconds: 60 * 60,
  },
} as const;
