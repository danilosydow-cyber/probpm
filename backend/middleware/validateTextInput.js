import { badRequest } from "../utils/apiErrors.js";

export function validateTextInput(req, _res, next) {
    const { text } = req.body || {};
    if (typeof text !== "string") {
        return next(badRequest("Bitte gib einen Text mit mindestens 5 Zeichen an.", { field: "text", minLength: 5 }));
    }

    const normalized = text.trim();
    if (normalized.length < 5) {
        return next(badRequest("Bitte gib einen Text mit mindestens 5 Zeichen an.", { field: "text", minLength: 5 }));
    }

    req.validatedText = normalized;
    return next();
}
