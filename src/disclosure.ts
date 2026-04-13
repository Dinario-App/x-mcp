const DISCLOSURE_MARKER = "on behalf of @elliotarledge";

/**
 * Auto-append the agent disclosure to outgoing tweet text.
 * Idempotent — if the marker is already present, returns the input unchanged.
 *
 * Regulatory/trust signal. This MUST be applied on every write path.
 * Any new adapter or client touching POST /2/tweets MUST route text
 * through this function before dispatch. See TASK-043 director sign-off.
 */
export function applyAgentDisclosure(text: string): string {
  if (text.includes(DISCLOSURE_MARKER)) {
    return text;
  }
  const model = process.env.CLAUDE_MODEL || "Claude Opus 4.6";
  return `${text}\n\n[${model} ${DISCLOSURE_MARKER}]`;
}
