import OpenAI from "openai";

import { AppError, badRequest } from "../../utils/apiErrors.js";
import { buildAnalyzePrompt } from "./prompt.js";
import { parseAnalyzerResponse } from "./parseResponse.js";
import { validateProcessShape } from "./validateProcess.js";
import { normalizeProcessJson } from "./normalizeProcess.js";

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

export async function analyzeTextToProcess(text) {
    if (!text || text.trim().length < 5) {
        throw badRequest("Text zu kurz fuer Analyse", { minLength: 5 }, "TEXT_TOO_SHORT");
    }

    const prompt = buildAnalyzePrompt(text.trim());

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
        throw new AppError("ANALYZE_FAILED", `Fehler bei KI-Analyse: ${error?.message || "Unbekannt"}`, 500);
    }
}
