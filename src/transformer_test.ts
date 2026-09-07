import { assertEquals, assertExists } from "@std/assert";
import {
  escapeJsonString,
  generateRandomSeed,
  transformTemplateString,
  transformZImageTurbo,
} from "./transformer.ts";

Deno.test("escapeJsonString", () => {
  assertEquals(escapeJsonString("simple text"), "simple text");
  assertEquals(
    escapeJsonString('text with "quotes"'),
    'text with \\"quotes\\"',
  );
  assertEquals(escapeJsonString("multi\nline\ttab"), "multi\\nline\\ttab");
});

Deno.test("generateRandomSeed", () => {
  const s1 = generateRandomSeed();
  // const s2 = generateRandomSeed();
  assertExists(s1);
  assertEquals(typeof s1, "number");
  // Seeds should be positive integers
  assertEquals(s1 >= 0, true);
});

Deno.test("transformTemplateString replaces all placeholders", () => {
  const dummyTemplate = `{
    "clip": { "inputs": { "text": "{{prompt}}" } },
    "latent": { "inputs": { "width": {{width}}, "height": {{height}} } },
    "sampler": { "inputs": { "seed": {{seed}} } }
  }`;

  const result = transformTemplateString(dummyTemplate, {
    prompt: 'A beautiful "sunset" over\nmountains',
    width: 512,
    height: 768,
    seed: 42,
  });

  assertEquals(result.seed, 42);
  const parsed = result.workflowJson as Record<
    string,
    { inputs: Record<string, unknown> }
  >;
  assertEquals(parsed.clip.inputs.text, 'A beautiful "sunset" over\nmountains');
  assertEquals(parsed.latent.inputs.width, 512);
  assertEquals(parsed.latent.inputs.height, 768);
  assertEquals(parsed.sampler.inputs.seed, 42);
});

Deno.test("transformZImageTurbo works with actual template file", () => {
  const result = transformZImageTurbo({
    prompt: "Tropical resort with infinity pool",
    width: 1024,
    height: 1024,
  });

  assertExists(result.workflowJson);
  const workflow = result.workflowJson as Record<
    string,
    { inputs: Record<string, unknown> }
  >;

  // Node 57:27 is CLIPTextEncode
  assertEquals(
    workflow["57:27"].inputs.text,
    "Tropical resort with infinity pool",
  );
  // Node 57:13 is EmptySD3LatentImage
  assertEquals(workflow["57:13"].inputs.width, 1024);
  assertEquals(workflow["57:13"].inputs.height, 1024);
  // Node 57:3 is KSampler
  assertEquals(typeof workflow["57:3"].inputs.seed, "number");
  assertEquals(workflow["57:3"].inputs.seed, result.seed);
});
