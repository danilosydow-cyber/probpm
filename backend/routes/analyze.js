import express from "express";
import { analyzeTextToProcess } from "../services/analyzer.js";
import { validateTextInput } from "../middleware/validateTextInput.js";

export function createAnalyzeRouter({ analyzeText = analyzeTextToProcess } = {}) {
    const router = express.Router();

    router.post("/", validateTextInput, async (req, res, next) => {
        try {
            const process = await analyzeText(req.validatedText);

            res.json({
                success: true,
                json: process
            });
        } catch (err) {
            next(err);
        }
    });

    return router;
}

const defaultRouter = createAnalyzeRouter();
export default defaultRouter;