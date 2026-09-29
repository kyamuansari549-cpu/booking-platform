import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const globalForDb = globalThis as unknown as {
  conn?: ReturnType<typeof postgres>;
};

// postgres-js connects lazily — safe to construct at import time even
// when DATABASE_URL is unset (queries will fail, construction won't).
function getConn() {
  if (!globalForDb.conn) {
    globalForDb.conn = postgres(process.env.DATABASE_URL ?? "", {
      max: 10,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return globalForDb.conn;
}

export const db = drizzle(getConn(), { schema });
export { schema };
