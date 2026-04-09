import { AppError } from "../../utils/apiErrors.js";

export function parseAnalyzerResponse(content) {
    if (typeof content !== "string" || content.trim().length === 0) {
        throw new AppError("EMPTY_AI_RESPONSE", "Leere oder ungueltige KI-Antwort erhalten", 422);
    }

    let cleaned = content
        .replace(/```json/gi, "")
        .replace(/```/g, "")
        .trim();

    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start !== -1 && end !== -1 && end > start) {
        cleaned = cleaned.substring(start, end + 1);
    }

    try {
        return JSON.parse(cleaned);
    } catch {
        throw new AppError("INVALID_JSON", "KI-Antwort ist kein gueltiges JSON", 422);
    }
}
