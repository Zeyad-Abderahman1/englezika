import { getToolRegistry, type ToolDefinition } from './tool-registry';

/**
 * AI Planner System Prompt & Bounded Repair Templates
 *
 * Provides a concise, deterministic tool catalog and strict matching constraints
 * tailored for local models (e.g. qwen2.5:1.5b-instruct with 2048 ctx window).
 */

export const SAFE_FALLBACK_REPLY = 'لم أتمكن من تحديد إجراء صالح لهذا الطلب. حاول إعادة صياغة الطلب.';

function describeField([name, schema]: [string, ToolDefinition['allowedKeys'][string]]): string {
  const requirement = schema.required ? 'required' : 'optional';
  return `${name}:${schema.type}:${requirement}`;
}

function toolCatalogLine(tool: ToolDefinition): string {
  const fields = Object.entries(tool.allowedKeys).map(describeField).join(', ') || 'none';
  const serverOwned = tool.serverOwnedKeys?.join(', ') || 'none';
  return `- ${tool.name}: ${tool.description} AI arguments=[${fields}]; server-owned=[${serverOwned}]; mutation=${tool.mutationType}; risk=${tool.riskLevel}; confirmation=${tool.confirmationPolicy}.`;
}

export function getCanonicalToolCatalog(): string {
  return Array.from(getToolRegistry().values()).map(toolCatalogLine).join('\n');
}

export function getPlannerSystemPrompt(): string {
  return `You are an educational assistant for Englizeka LMS.
Output ONLY valid JSON: { "planText": string, "actions": [{ "tool": string, "parameters": object, "description": string }], "explanation": string }

AVAILABLE TOOLS (generated from the authoritative registry):
${getCanonicalToolCatalog()}

RULES:
- "tool" MUST EXACTLY match one of AVAILABLE TOOLS.
- Never translate, rename, or invent tool names (e.g. displayCourses, showCourses, getCourses, fetchCourses, viewCourses are STRICTLY FORBIDDEN).
- For viewing, listing, or showing all courses, use "list_courses".
- Read-only requests must use read-only tools.
- A request to show, list, view, or retrieve data REQUIRES a tool action. Do NOT return only planText with empty actions for data requests.
- planText is NOT a substitute for tool execution.
- If no tool matches the request, return "actions": [].
`;
}

export function getSchemaRepairPrompt(
  originalInstruction: string,
  validationErrors: string[]
): string {
  return `Correction required: the previous plan failed authoritative schema validation.
Errors:
${validationErrors.map((error) => `- ${error}`).join('\n')}

Use only this authoritative registry catalog:
${getCanonicalToolCatalog()}

Do not silently remove or execute invalid arguments. Return a newly planned action using only declared AI arguments. Never supply actor identity, permissions, confirmation state, status, is_active, publish state, owner identity, or audit fields. Do not invent missing business values.
Original request: "${originalInstruction}"
Output valid JSON: { "planText": string, "actions": [{ "tool": string, "parameters": object }], "explanation": string }`;
}

export function getEmptyActionRepairPrompt(originalInstruction: string): string {
  return `You returned no actions, but the user requested an operation.
Return the correct canonical registered tool action.
Use the authoritative registry catalog:
${getCanonicalToolCatalog()}
planText alone is NOT a valid response to a data request.
Original request: "${originalInstruction}"
Output valid JSON: { "planText": string, "actions": [{ "tool": string, "parameters": object }], "explanation": string }`;
}
