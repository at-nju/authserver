import { connect } from "cloudflare:sockets";
import type { Env } from "./env";
import {
  buildVerificationEmail,
  dotStuffSmtpData,
  encodeSmtpAuth,
  parseSmtpReplyStart,
} from "./smtp_protocol";

const SMTP_HOST = "smtp.feishu.cn";
const SMTP_PORT = 465;
const SMTP_USERNAME = "noreply@nju.at";
const SMTP_FROM = "noreply@nju.at";
const SMTP_EHLO_HOST = "auth.nju.at";

interface SmtpReply {
  code: number;
  lines: string[];
}

type WorkerSocket = ReturnType<typeof connect>;

class SmtpConnection {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();
  private buffer = "";

  constructor(private readonly socket: WorkerSocket) {
    this.reader = socket.readable.getReader();
    this.writer = socket.writable.getWriter();
  }

  private async readLine(): Promise<string> {
    while (true) {
      const separator = this.buffer.indexOf("\r\n");
      if (separator >= 0) {
        const line = this.buffer.slice(0, separator);
        this.buffer = this.buffer.slice(separator + 2);
        return line;
      }

      const { value, done } = await this.reader.read();
      if (done) throw new Error("SMTP connection closed unexpectedly");
      this.buffer += this.decoder.decode(value, { stream: true });
    }
  }

  async readReply(): Promise<SmtpReply> {
    const firstLine = await this.readLine();
    const start = parseSmtpReplyStart(firstLine);
    if (!start) throw new Error("SMTP server returned an invalid response");

    const lines = [firstLine];
    if (start.continued) {
      while (true) {
        const line = await this.readLine();
        lines.push(line);
        if (line.startsWith(`${start.code} `)) break;
      }
    }
    return { code: start.code, lines };
  }

  async writeLine(line: string): Promise<void> {
    await this.writer.write(this.encoder.encode(`${line}\r\n`));
  }

  async command(line: string, expectedCodes: number[]): Promise<SmtpReply> {
    await this.writeLine(line);
    const reply = await this.readReply();
    if (!expectedCodes.includes(reply.code)) {
      throw new Error(`SMTP server rejected a command with status ${reply.code}`);
    }
    return reply;
  }

  async writeData(message: string): Promise<void> {
    const normalized = dotStuffSmtpData(message);
    const terminated = normalized.endsWith("\r\n")
      ? `${normalized}.\r\n`
      : `${normalized}\r\n.\r\n`;
    await this.writer.write(this.encoder.encode(terminated));
    const reply = await this.readReply();
    if (reply.code !== 250) {
      throw new Error(`SMTP server rejected the email with status ${reply.code}`);
    }
  }

  async close(): Promise<void> {
    try {
      await this.command("QUIT", [221]);
    } catch {
      // The message has already been accepted; a failed QUIT does not change delivery.
    }
    this.reader.releaseLock();
    this.writer.releaseLock();
    await this.socket.close();
  }
}

async function authenticate(
  connection: SmtpConnection,
  capabilities: SmtpReply,
  password: string,
): Promise<void> {
  const advertised = capabilities.lines.join("\n").toUpperCase();
  if (advertised.includes("AUTH PLAIN")) {
    const payload = encodeSmtpAuth(`\u0000${SMTP_USERNAME}\u0000${password}`);
    await connection.command(`AUTH PLAIN ${payload}`, [235]);
    return;
  }

  await connection.command("AUTH LOGIN", [334]);
  await connection.command(encodeSmtpAuth(SMTP_USERNAME), [334]);
  await connection.command(encodeSmtpAuth(password), [235]);
}

export function isEmailDeliveryConfigured(env: Env): boolean {
  return Boolean(env.SMTP_PASSWORD?.trim());
}

export async function sendVerificationEmail(
  env: Env,
  email: string,
  otp: string,
): Promise<void> {
  const password = env.SMTP_PASSWORD?.trim();
  if (!password) throw new Error("SMTP is not configured");

  const socket = connect(
    { hostname: SMTP_HOST, port: SMTP_PORT },
    { secureTransport: "on", allowHalfOpen: false },
  );
  await socket.opened;
  const connection = new SmtpConnection(socket);

  try {
    const greeting = await connection.readReply();
    if (greeting.code !== 220) {
      throw new Error(`SMTP greeting failed with status ${greeting.code}`);
    }
    const capabilities = await connection.command(`EHLO ${SMTP_EHLO_HOST}`, [250]);
    await authenticate(connection, capabilities, password);
    await connection.command(`MAIL FROM:<${SMTP_FROM}>`, [250]);
    await connection.command(`RCPT TO:<${email}>`, [250, 251]);
    await connection.command("DATA", [354]);
    await connection.writeData(buildVerificationEmail({ to: email, otp }));
  } finally {
    await connection.close();
  }
}
