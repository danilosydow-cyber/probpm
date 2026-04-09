import OpenAI from "openai";

import { MAX_PROCESS_TEXT_CHARS, MIN_PROCESS_TEXT_CHARS } from "../../constants.js";
import { AppError, badRequest } from "../../utils/apiErrors.js";
import { buildAnalyzePrompt } from "./prompt.js";
import { parseAnalyzerResponse } from "./parseResponse.js";
import { validateProcessShape } from "./validateProcess.js";
import { normalizeProcessJson } from "./normalizeProcess.js";

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

export async function analyzeTextToProcess(text) {
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (!trimmed || trimmed.length < MIN_PROCESS_TEXT_CHARS) {
        throw badRequest("Text zu kurz fuer Analyse", { minLength: MIN_PROCESS_TEXT_CHARS }, "TEXT_TOO_SHORT");
    }
    if (trimmed.length > MAX_PROCESS_TEXT_CHARS) {
        throw badRequest("Text zu lang fuer Analyse", { maxLength: MAX_PROCESS_TEXT_CHARS }, "TEXT_TOO_LONG");
    }

    const prompt = buildAnalyzePrompt(trimmed);

    try {
        const response = await client.chat.completions.create({
            model: "gpt-4.1",
            temperature: 0,
            messages: [
                {
                    role: "system",
                    content: "Du bist ein extrem praeziser BPMN-Prozess-Parser."
                },
                {
                    role: "user",
                    content: prompt
                }
            ]
        });

        const content = response?.choices?.[0]?.message?.content;
        const parsed = parseAnalyzerResponse(content);
        validateProcessShape(parsed);
        return normalizeProcessJson(parsed);
    } catch (error) {
        if (error instanceof AppError) throw error;
        console.error(error);
        throw new AppError("ANALYZE_FAILED", "Analyse fehlgeschlagen", 500);
    }
}
