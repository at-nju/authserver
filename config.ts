export type Env = {
  BETTER_AUTH_SECRET: string;
  SEATABLE_API_TOKEN: string;
  SMTP_PASSWORD: string;
  DISCOURSE_CONNECT_SECRET?: string;
  UPSTREAM_OIDC_CLIENT_ID?: string;
  UPSTREAM_OIDC_CLIENT_SECRET?: string;
};

export const config = {
  appName: "NJU Auth",

  auth: {
    basePath: "/",
    sessionTtlSeconds: 7 * 24 * 60 * 60,
  },

  oidc: {
    scopes: ["openid", "profile", "email"],
    authorizationCodeTtlSeconds: 10 * 60,
    accessTokenTtlSeconds: 60 * 60,
  },

  providers: {
    seatable: {
      enabled: true,
      registration: "allow",
      baseUrl: "https://table.nju.edu.cn",
      tableName: "Table1",
      idColumn: "ID",
      tokenColumn: "Token",
      fields: {
        subject: "id",
        name: "id",
        email: (identity: { id: string }) => `${identity.id}@smail.nju.edu.cn`,
        emailVerified: false,
      },
    },
    email: {
      enabled: true,
      registration: {
        mode: "email-domain",
        domains: ["smail.nju.edu.cn", "nju.edu.cn"],
      },
      fields: {
        subject: "email",
        name: "email",
        email: "email",
        emailVerified: true,
      },
      otpLength: 6,
      otpTtlSeconds: 10 * 60,
      subject: "NJU Auth 邮箱验证码",
      text: (otp: string) => `你的验证码是 ${otp}，10 分钟内有效。`,
      smtp: {
        host: "smtp.feishu.cn",
        port: 465,
        secure: true,
        username: "noreply@nju.at",
        from: "noreply@nju.at",
      },
    },
    discourse: {
      enabled: false,
      registration: "allow",
      origin: "https://forum.example.com",
      fields: {
        subject: "external_id",
        name: ["name", "username"],
        email: "email",
        emailVerified: true,
      },
    },
    upstreamOidc: {
      enabled: false,
      registration: "allow",
      issuer: "https://id.example.com",
      scopes: ["openid", "profile", "email"],
      fields: {
        subject: "sub",
        name: ["name", "preferred_username"],
        email: "email",
        emailVerified: "email_verified",
      },
    },
  },
} as const;
