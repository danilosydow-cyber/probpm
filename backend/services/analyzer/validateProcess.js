import { AppError } from "../../utils/apiErrors.js";

export function validateProcessShape(processJson) {
    if (!processJson || typeof processJson !== "object") {
        throw new AppError("SCHEMA_MISMATCH", "Analyse-Ergebnis hat kein gueltiges Objektformat", 422);
    }

    if (!Array.isArray(processJson.roles) || processJson.roles.length === 0) {
        throw new AppError("SCHEMA_MISMATCH", "Keine Rollen erkannt", 422);
    }

    if (!Array.isArray(processJson.steps) || processJson.steps.length === 0) {
        throw new AppError("SCHEMA_MISMATCH", "Keine Schritte erkannt", 422);
    }

    const ids = new Set();
    for (const step of processJson.steps) {
        if (!step || typeof step !== "object") {
            throw new AppError("SCHEMA_MISMATCH", "Schritt ist ungueltig", 422);
        }

        if (typeof step.id !== "string" || step.id.trim().length === 0) {
            throw new AppError("SCHEMA_MISMATCH", "Schritt ohne gueltige ID", 422);
        }

        if (ids.has(step.id)) {
            throw new AppError("DUPLICATE_STEP_ID", `Doppelte Step-ID: ${step.id}`, 422);
        }
        ids.add(step.id);
    }

    const hasEnd = processJson.steps.some((step) => step?.type === "end" || step?.type === "endEvent");
    if (!hasEnd) {
        throw new AppError("MISSING_END_EVENT", "Mindestens 1 End Event erforderlich", 422);
    }
}
