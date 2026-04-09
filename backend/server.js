import 'dotenv/config';

import express from "express";
import cors from "cors";

import { createAnalyzeRouter } from "./routes/analyze.js";
import { createGenerateRouter } from "./routes/generate.js";
import { analyzeTextToProcess } from "./services/analyzer.js";
import { AppError, toErrorResponse } from "./utils/apiErrors.js";

const defaultPort = Number(process.env.PORT) || 5000;

export function createApp({ analyzeText = analyzeTextToProcess } = {}) {
    const app = express();

    app.use(cors());
    app.use(express.json({ limit: "512kb" }));

    app.use("/api/analyze", createAnalyzeRouter({ analyzeText }));
    app.use("/api/generate", createGenerateRouter({ analyzeText }));

    app.use((err, _req, res, _next) => {
        const clientError = err instanceof AppError && err.status < 500;
        if (!clientError) {
            console.error(err);
        }
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