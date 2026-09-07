import "@std/dotenv/load";

// Server and environment configuration

export interface Config {
  destinationServerUrl: string;
  adminUsername: string;
  adminPassword: string;
  port: number;
  dbPath: string;
}

export function loadConfig(): Config {
  const destinationServerUrl =
    Deno.env.get("DESTINATION_SERVER_URL") || "http://127.0.0.1:8188";
  const adminUsername = Deno.env.get("ADMIN_USERNAME") || "admin";
  const adminPassword = Deno.env.get("ADMIN_PASSWORD") || "admin";
  const port = parseInt(Deno.env.get("PORT") || "8000", 10);
  const dbPath = Deno.env.get("DB_PATH") || "data/logs.db";

  return {
    destinationServerUrl,
    adminUsername,
    adminPassword,
    port,
    dbPath,
  };
}

export const config = loadConfig();
