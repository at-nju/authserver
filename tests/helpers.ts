import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

export function testDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync("migrations").filter((name) => name.endsWith(".sql")).sort()) {
    sqlite.exec(readFileSync(`migrations/${file}`, "utf8"));
  }
  return sqlite;
}
