import 'dotenv/config';

import express from "express";
import cors from "cors";

import analyzeRoute from "./routes/analyze.js";
import { analyzeTextToProcess } from "./services/analyzer.js";
import { generateBPMN } from "./services/bpmnGenerator.js";

const defaultPort = Number(process.env.PORT) || 5000;

export function createApp({ analyzeText = analyzeTextToProcess } = {}) {
    const app = express();

    // Middleware
    app.use(cors());
    app.use(express.json());

    // =====================================================
    // 🧠 ROUTE: NUR JSON (bestehend lassen)
    // =====================================================
    app.use("/api/analyze", analyzeRoute);


    // =====================================================
    // 🔥 FULL PIPELINE: TEXT → JSON → BPMN XML (Dual Prompt)
    // =====================================================
    app.post("/api/generate", async (req, res) => {
        try {
            const { text } = req.body;

            if (typeof text !== "string" || text.trim().length < 5) {
                return res.status(400).json({
                    success: false,
                    error: "Bitte gib einen Text mit mindestens 5 Zeichen an."
                });
            }

            const process = await analyzeText(text.trim());
            const xml = generateBPMN(process);

            // =========================
            // 🔥 STEP 5 – RESPONSE
            // =========================
            res.json({
                success: true,
                json: process,
                xml
            });

        } catch (err) {
            console.error("❌ Fehler in /api/generate:", err);

            res.status(500).json({
                success: false,
                error: err?.message || "Interner Serverfehler"
            });
        }
    });

    return app;
}

export function startServer(port = defaultPort) {
    const app = createApp();
    return app.listen(port, () => {
        console.log(`🚀 Server läuft auf Port ${port}`);
    });
}

export const app = createApp();