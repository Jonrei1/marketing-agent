// Server-only module: reads process.env.ANTHROPIC_API_KEY and is only ever
// imported from app/api/enrich/route.ts, never from a client component.
import Anthropic from "@anthropic-ai/sdk";
import type { ContactField, CreatorDetail, CreatorSummary } from "./types";

// Automatic cutoffs so a pathological bio (or a client bypassing the UI)
// can't blow up the Anthropic request size/cost. Bios are user-generated
// text pulled from TikTok profiles — never trust their length.
const MAX_BIO_CHARS = 400;
const MAX_CREATORS_PER_CALL = 10;

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function emptyField(): ContactField {
  return { value: "", found: false };
}

function toField(value: string | null | undefined): ContactField {
  if (!value) return emptyField();
  return { value, found: true };
}

// Fallback bio parser — plain regex, used only if the live Claude call fails.
// It must produce the exact same CreatorDetail shape as the live path.
function regexEnrich(creators: CreatorSummary[]): CreatorDetail[] {
  const emailRe = /[\w.+-]+@[\w-]+\.[\w.-]+/;
  const mobileRe = /\b09\d{2}[- ]?\d{3}[- ]?\d{2,4}\b/;
  const viberRe = /viber[^0-9]*(\b09\d{2}[- ]?\d{3}[- ]?\d{2,4}\b)/i;

  return creators.map((c) => {
    const emailMatch = c.bio.match(emailRe)?.[0];
    const viberMatch = c.bio.match(viberRe)?.[1];
    const mobileMatch = c.bio.match(mobileRe)?.[0];
    return {
      ...c,
      email: toField(emailMatch),
      viber: toField(viberMatch),
      mobile: toField(viberMatch ? undefined : mobileMatch),
    };
  });
}

export async function enrichCreators(creators: CreatorSummary[]): Promise<CreatorDetail[]> {
  // Belt-and-braces cap — the route handler already caps at 10, this keeps
  // the function safe if ever called directly.
  const capped = creators.slice(0, MAX_CREATORS_PER_CALL).map((c) => ({
    ...c,
    bio: truncate(c.bio, MAX_BIO_CHARS),
  }));

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("[claudeClient] ANTHROPIC_API_KEY not set — using regex fallback enrichment");
    return regexEnrich(capped);
  }

  try {
    const client = new Anthropic({ apiKey });

    const response = await client.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      tools: [
        {
          name: "report_contacts",
          description: "Report extracted contact fields for each creator bio.",
          input_schema: {
            type: "object",
            properties: {
              contacts: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    id: { type: "string" },
                    email: { type: ["string", "null"] },
                    viber: { type: ["string", "null"] },
                    mobile: { type: ["string", "null"] },
                  },
                  required: ["id", "email", "viber", "mobile"],
                },
              },
            },
            required: ["contacts"],
          },
        },
      ],
      tool_choice: { type: "tool", name: "report_contacts" },
      messages: [
        {
          role: "user",
          content:
            "Extract email, Viber number, and mobile number from each creator's bio below. " +
            "Only report a value if it is literally present in the bio text — never invent or guess. " +
            "Use null when a field is absent.\n\n" +
            capped
              .map((c) => `id: ${c.id}\nusername: ${c.username}\nbio: ${c.bio}`)
              .join("\n\n"),
        },
      ],
    });

    const toolUse = response.content.find((block) => block.type === "tool_use");
    if (!toolUse || toolUse.type !== "tool_use") throw new Error("no tool_use block in response");

    const parsed = toolUse.input as {
      contacts: Array<{ id: string; email: string | null; viber: string | null; mobile: string | null }>;
    };

    return capped.map((c) => {
      const match = parsed.contacts.find((p) => p.id === c.id);
      return {
        ...c,
        email: toField(match?.email),
        viber: toField(match?.viber),
        mobile: toField(match?.mobile),
      };
    });
  } catch (err) {
    console.warn("[claudeClient] live enrichment failed, falling back to regex extraction:", err);
    return regexEnrich(capped);
  }
}
