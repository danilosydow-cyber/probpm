import 'dotenv/config';

import express from "express";
import cors from "cors";

import { createAnalyzeRouter } from "./routes/analyze.js";
import { analyzeTextToProcess } from "./services/analyzer.js";
import { generateBPMN } from "./services/bpmnGenerator.js";
import { validateTextInput } from "./middleware/validateTextInput.js";
import { toErrorResponse } from "./utils/apiErrors.js";

const defaultPort = Number(process.env.PORT) || 5000;

export function createApp({ analyzeText = analyzeTextToProcess } = {}) {
    const app = express();

    // Middleware
    app.use(cors());
    app.use(express.json());

    app.use("/api/analyze", createAnalyzeRouter({ analyzeText }));


    app.post("/api/generate", validateTextInput, async (req, res, next) => {
        try {
            const process = await analyzeText(req.validatedText);
            const xml = generateBPMN(process);

            res.json({
                success: true,
                json: process,
                xml
            });
        } catch (err) {
            next(err);
        }
    });

    app.use((err, _req, res, _next) => {
        const mapped = toErrorResponse(err);
        res.status(mapped.status).json(mapped.body);
    });

    return app;
}

export function startServer(port = defaultPort) {
    const app = createApp();
    return app.listen(port, () => {
        console.log(`Server laeuft auf Port ${port}`);
    });
}

export const app = createApp();