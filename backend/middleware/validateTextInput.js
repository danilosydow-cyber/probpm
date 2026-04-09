import { MIN_PROCESS_TEXT_CHARS } from "../constants.js";
import { badRequest } from "../utils/apiErrors.js";

export function validateTextInput(req, _res, next) {
    const { text } = req.body || {};
    if (typeof text !== "string") {
        return next(
            badRequest(`Bitte gib einen Text mit mindestens ${MIN_PROCESS_TEXT_CHARS} Zeichen an.`, {
                field: "text",
                minLength: MIN_PROCESS_TEXT_CHARS
            })
        );
    }

    const normalized = text.trim();
    if (normalized.length < MIN_PROCESS_TEXT_CHARS) {
        return next(
            badRequest(`Bitte gib einen Text mit mindestens ${MIN_PROCESS_TEXT_CHARS} Zeichen an.`, {
                field: "text",
                minLength: MIN_PROCESS_TEXT_CHARS
            })
        );
    }

    req.validatedText = normalized;
    return next();
}
