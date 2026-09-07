import { app } from "./src/app.ts";
import { config } from "./src/config.ts";

export default app;

if (import.meta.main) {
  console.log(`🚀 AI Transformation Server running on http://localhost:${config.port}`);
  console.log(`📊 Dashboard available at http://localhost:${config.port}/_dashboard`);
  console.log(`🎯 Destination Server configured at ${config.destinationServerUrl}`);

  Deno.serve({ port: config.port }, app.fetch);
}
