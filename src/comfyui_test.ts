import { assertEquals } from "@std/assert";
import { toWsUrl } from "./comfyui.ts";

Deno.test("toWsUrl handles domain names and HTTPS/HTTP protocols", () => {
  assertEquals(
    toWsUrl("http://localhost:8188", "client-123"),
    "ws://localhost:8188/ws?clientId=client-123",
  );

  assertEquals(
    toWsUrl("https://comfy.example.com", "client-456"),
    "wss://comfy.example.com/ws?clientId=client-456",
  );

  assertEquals(
    toWsUrl("https://ai-server.domain.com:8443/custom-path/", "client-789"),
    "wss://ai-server.domain.com:8443/custom-path/ws?clientId=client-789",
  );
});
