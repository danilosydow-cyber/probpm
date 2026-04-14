import express from "express";

import { optimizeProcessText } from "../services/analyzer/index.js";
import { validateTextInput } from "../middleware/validateTextInput.js";

export function createOptimizeRouter({ optimizeText = optimizeProcessText } = {}) {
    const router = express.Router();

    router.post("/", validateTextInput, async (req, res, next) => {
        try {
            const optimizedText = await optimizeText(req.validatedText);
            res.json({
                success: true,
                optimizedText
            });
        } catch (err) {
            next(err);
        }
    });

    return router;
}
