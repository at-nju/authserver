import type { Env } from "./env";

function ownerKey(userId: string, clientId: string): string {
  return `owner:${userId}:${clientId}`;
}

function clientOwnerKey(clientId: string): string {
  return `client:${clientId}:owner`;
}

export async function addOwnership(env: Env, userId: string, clientId: string): Promise<void> {
  await Promise.all([
    env.CONSOLE_KV.put(ownerKey(userId, clientId), "1"),
    env.CONSOLE_KV.put(clientOwnerKey(clientId), userId),
  ]);
}

export async function removeOwnership(env: Env, userId: string, clientId: string): Promise<void> {
  await Promise.all([
    env.CONSOLE_KV.delete(ownerKey(userId, clientId)),
    env.CONSOLE_KV.delete(clientOwnerKey(clientId)),
  ]);
}

export async function ownerOf(env: Env, clientId: string): Promise<string | null> {
  return env.CONSOLE_KV.get(clientOwnerKey(clientId));
}

export async function listClientIds(env: Env, userId: string): Promise<string[]> {
  const prefix = `owner:${userId}:`;
  const res = await env.CONSOLE_KV.list({ prefix });
  return res.keys.map((k) => k.name.slice(prefix.length));
}
