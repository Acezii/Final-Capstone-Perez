const SYSTEM_PROMPT = `You are the Path-Finder AI assistant for the College of Computing Studies BSIT program at Universidad de Manila. You help irregular and shifter students with common questions about prerequisites, enrollment steps, scheduling, and how to use the Path-Finder system.

Answer questions the student can resolve themselves directly and concisely, using the student context you are given.

If a question requires a human decision from the registrar, department head, or academic staff (for example: prerequisite waivers, credit re-evaluation for shifters, exceptions to the unit cap, disputes about grades or records, or anything you cannot resolve from the given data), do not guess. Instead tell the student you are forwarding this to the CCS staff, and end your reply with a line that starts exactly with "ESCALATE:" followed by a one-sentence summary of the concern for the staff member who will handle it.

Keep replies short and plain. Do not use markdown headers.`;

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const FALLBACK_MODEL = "@cf/meta/llama-3.1-8b-instruct";
const MAX_HISTORY_MESSAGES = 12;
const MAX_TOKENS = 500;

function buildMessages(studentContext, history, message) {
  const trimmedHistory = history.slice(-MAX_HISTORY_MESSAGES);
  return [
    { role: "system", content: `${SYSTEM_PROMPT}\n\nStudent context:\n${JSON.stringify(studentContext)}` },
    ...trimmedHistory.map((m) => ({ role: m.sender === "student" ? "user" : "assistant", content: m.content })),
    { role: "user", content: message },
  ];
}

function parseResult(fullText) {
  const escalateIdx = fullText.indexOf("ESCALATE:");
  if (escalateIdx === -1) {
    return { reply: fullText, escalate: false, summary: null };
  }
  const reply = fullText.slice(0, escalateIdx).trim();
  const summary = fullText.slice(escalateIdx + "ESCALATE:".length).trim();
  return {
    reply: reply || "I'm forwarding this to the CCS staff.",
    escalate: true,
    summary: summary || "Student raised a concern the assistant could not resolve.",
  };
}

async function runModel(env, model, messages) {
  const result = await env.AI.run(model, { messages, max_tokens: MAX_TOKENS });
  return (result?.response ?? "").trim();
}

export async function askAssistant(env, studentContext, history, message) {
  if (!env.AI) {
    throw new Error("Workers AI binding is not configured");
  }
  if (!message || !message.trim()) {
    throw new Error("Message is required");
  }
  const messages = buildMessages(studentContext, history || [], message);
  let fullText;
  try {
    fullText = await runModel(env, MODEL, messages);
  } catch (err) {
    try {
      fullText = await runModel(env, FALLBACK_MODEL, messages);
    } catch (fallbackErr) {
      throw new Error(`Workers AI error: ${fallbackErr.message}`);
    }
  }
  if (!fullText) {
    return {
      reply: "I couldn't come up with a response — try rephrasing, or I can forward this to CCS staff.",
      escalate: false,
      summary: null,
    };
  }
  return parseResult(fullText);
}
