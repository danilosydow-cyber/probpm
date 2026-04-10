/** BPMN activity kinds the analyzer may emit (camelCase, BPMN 2.0). */
export const ALLOWED_TASK_KINDS = new Set([
    "task",
    "userTask",
    "serviceTask",
    "manualTask",
    "scriptTask",
    "sendTask",
    "receiveTask",
    "businessRuleTask"
]);

export const PROBPM_EMAIL_NS = "http://probpm.local/ns/bpmn-email";

export function sanitizeTaskKind(raw) {
    const k = String(raw ?? "task").trim();
    if (!k) return "task";
    const key = k.charAt(0).toLowerCase() + k.slice(1);
    return ALLOWED_TASK_KINDS.has(key) ? key : "task";
}

function escapeXml(value) {
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

/**
 * Structured e-mail metadata (Designer/BCS-style); stored as extensionElements for tools that read custom XML.
 */
export function buildEmailExtensionXml(email) {
    if (!email || typeof email !== "object") return "";

    const recipient = escapeXml(String(email.to ?? email.recipient ?? "").trim());
    const cc = escapeXml(String(email.cc ?? "").trim());
    const bcc = escapeXml(String(email.bcc ?? "").trim());
    const from = escapeXml(String(email.from ?? email.sender ?? "").trim());
    const subject = escapeXml(String(email.subject ?? "").trim());
    const template = escapeXml(String(email.template ?? "").trim());
    const body = escapeXml(String(email.body ?? "").trim());
    const noStyling = email.noBcsStyling === true ? "true" : "false";

    if (!recipient && !subject && !template && !body) return "";

    return `<bpmn:extensionElements><probpm:email xmlns:probpm="${PROBPM_EMAIL_NS}" recipient="${recipient}" cc="${cc}" bcc="${bcc}" from="${from}" subject="${subject}" template="${template}" body="${body}" noBcsStyling="${noStyling}" /></bpmn:extensionElements>`;
}

/**
 * Serializes one activity (task / userTask / serviceTask / …) including optional documentation and e-mail extension.
 */
export function buildActivityElementXml(step, escapedName) {
    // Always render activities as neutral BPMN tasks (no task-type icon).
    // taskKind can still be present in JSON for analysis purposes, but it is ignored in XML output.
    const tag = "task";

    const docRaw = step.documentation;
    const docXml =
        typeof docRaw === "string" && docRaw.trim().length > 0
            ? `<bpmn:documentation>${escapeXml(docRaw.trim())}</bpmn:documentation>`
            : "";

    const emailXml = buildEmailExtensionXml(step.email);

    const inner = `${docXml}${emailXml}`;
    if (!inner) {
        return `<bpmn:${tag} id="${step.id}" name="${escapedName}" />`;
    }
    return `<bpmn:${tag} id="${step.id}" name="${escapedName}">${inner}</bpmn:${tag}>`;
}
