interface D1Result<T = Record<string, unknown>> {
  success: boolean;
  results: T[];
  meta?: { duration?: number; changes?: number };
}

interface D1Statement {
  bind(...values: unknown[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
}

interface D1Database {
  prepare(query: string): D1Statement;
}

interface Env {
  DB: D1Database;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return json({
        service: "mainwell",
        status: "ok",
        database: "configured",
        timestamp: new Date().toISOString()
      });
    }

    if (request.method === "GET" && url.pathname === "/api/health/db") {
      try {
        const result = await env.DB.prepare("SELECT 1 AS ok").first<{ ok: number }>();
        const schema = await env.DB.prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'recovery_grants'"
        ).first<{ name: string }>();

        return json({
          service: "mainwell",
          database: result?.ok === 1 ? "connected" : "unavailable",
          schema: schema?.name === "recovery_grants" ? "initialized" : "pending",
          timestamp: new Date().toISOString()
        }, result?.ok === 1 ? 200 : 503);
      } catch {
        return json({
          service: "mainwell",
          database: "unavailable",
          error: "Database health check failed"
        }, 503);
      }
    }

    return json({ error: "Not found" }, 404);
  }
};
