import express from "express";

import { analyzeTextToProcess } from "../services/analyzer.js";
import { generateBPMN } from "../services/bpmnGenerator.js";
import { validateTextInput } from "../middleware/validateTextInput.js";

export function createGenerateRouter({
    analyzeText = analyzeTextToProcess,
    generateBpmn = generateBPMN
} = {}) {
    const router = express.Router();

    router.post("/", validateTextInput, async (req, res, next) => {
        try {
            const processJson = await analyzeText(req.validatedText);
            const xml = generateBpmn(processJson);

            res.json({
                success: true,
                json: processJson,
                xml
            });
        } catch (err) {
            next(err);
        }
    });

    return router;
}
