export function connect(): never {
  throw new Error("cloudflare:sockets is unavailable in the Node test runtime");
}
