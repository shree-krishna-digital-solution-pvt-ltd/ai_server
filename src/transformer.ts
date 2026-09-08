// Workflow template transformer using placeholder regex replacement

export interface ZImageTurboInput {
  prompt: string;
  width?: number;
  height?: number;
  seed?: number;
}

export interface FluxImageEditInput {
  image1: string;
  image2: string;
  prompt: string;
  seed?: number;
}

const templateCache: Map<string, string> = new Map();

export function loadTemplate(templatePath: string): string {
  if (templateCache.has(templatePath)) {
    return templateCache.get(templatePath)!;
  }
  const content = Deno.readTextFileSync(templatePath);
  templateCache.set(templatePath, content);
  return content;
}

export function clearTemplateCache(): void {
  templateCache.clear();
}

/**
 * Generate a safe positive integer seed for ComfyUI.
 */
export function generateRandomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000_000_000);
}

/**
 * Safely escape a prompt string to be inserted into a JSON string literal.
 */
export function escapeJsonString(str: string): string {
  // Use JSON.stringify and slice off the outer quotes
  return JSON.stringify(str).slice(1, -1);
}

/**
 * Transform template string by replacing {{field}} placeholders with actual values for z-image-turbo.
 */
export function transformTemplateString(
  templateContent: string,
  params: ZImageTurboInput,
): { workflowJson: Record<string, unknown>; rawJsonString: string; seed: number } {
  const prompt = params.prompt || "";
  const width = typeof params.width === "number" && params.width > 0 ? params.width : 1024;
  const height = typeof params.height === "number" && params.height > 0 ? params.height : 1024;
  const seed = typeof params.seed === "number" && params.seed >= 0 ? params.seed : generateRandomSeed();

  const escapedPrompt = escapeJsonString(prompt);

  // Replace placeholders
  const transformed = templateContent
    .replace(/\{\{prompt\}\}/g, escapedPrompt)
    .replace(/\{\{width\}\}/g, String(width))
    .replace(/\{\{height\}\}/g, String(height))
    .replace(/\{\{seed\}\}/g, String(seed));

  let workflowJson: Record<string, unknown>;
  try {
    workflowJson = JSON.parse(transformed);
  } catch (err) {
    throw new Error(`Failed to parse transformed ComfyUI workflow JSON: ${err}`);
  }

  return {
    workflowJson,
    rawJsonString: transformed,
    seed,
  };
}

/**
 * Transform the default z-image-turbo workflow.
 */
export function transformZImageTurbo(
  params: ZImageTurboInput,
  templatePath = "./image_z_image_turbo.json",
): { workflowJson: Record<string, unknown>; rawJsonString: string; seed: number } {
  const template = loadTemplate(templatePath);
  return transformTemplateString(template, params);
}

/**
 * Transform the 2-image Flux image edit workflow.
 */
export function transformFluxImageEdit(
  params: FluxImageEditInput,
  templatePath = "./flux_image_edit.json",
): { workflowJson: Record<string, unknown>; rawJsonString: string; seed: number } {
  const template = loadTemplate(templatePath);
  const prompt = params.prompt || "";
  const image1 = params.image1 || "";
  const image2 = params.image2 || "";
  const seed = typeof params.seed === "number" && params.seed >= 0 ? params.seed : generateRandomSeed();

  const escapedPrompt = escapeJsonString(prompt);
  const escapedImage1 = escapeJsonString(image1);
  const escapedImage2 = escapeJsonString(image2);

  const transformed = template
    .replace(/\{\{prompt\}\}/g, escapedPrompt)
    .replace(/\{\{image1\}\}/g, escapedImage1)
    .replace(/\{\{image2\}\}/g, escapedImage2)
    .replace(/\{\{seed\}\}/g, String(seed));

  let workflowJson: Record<string, unknown>;
  try {
    workflowJson = JSON.parse(transformed);
  } catch (err) {
    throw new Error(`Failed to parse transformed Flux ComfyUI workflow JSON: ${err}`);
  }

  return {
    workflowJson,
    rawJsonString: transformed,
    seed,
  };
}
