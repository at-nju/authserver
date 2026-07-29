export type Env = {
  PUBLIC_BASE_URL?: string;
  BETTER_AUTH_SECRET: string;
  SEATABLE_API_TOKEN: string;
  SMTP_USERNAME: string;
  SMTP_PASSWORD: string;
  SMTP_FROM: string;
};

export const config = {
  appName: "NJU Auth",

  auth: {
    basePath: "/",
    defaultBaseUrl: "https://auth.nju.at",
    sessionTtlSeconds: 7 * 24 * 60 * 60,
  },

  seatable: {
    baseUrl: "https://table.nju.edu.cn",
    tableName: "Table1",
    idColumn: "ID",
    tokenColumn: "Token",
  },

  user: {
    defaultEmailTemplate: "{id}@smail.nju.edu.cn",
  },

  email: {
    otpLength: 6,
    otpTtlSeconds: 10 * 60,
  },

  smtp: {
    host: "smtp.feishu.cn",
    port: 465,
    secure: true,
    authType: "login",
  },

  oidc: {
    scopes: ["openid", "profile", "email"],
    authorizationCodeTtlSeconds: 10 * 60,
    accessTokenTtlSeconds: 60 * 60,
  },
} as const;
