import "dotenv/config";

import express from "express";
import cors from "cors";

import { analyzeText } from "./services/processAnalyzer.js"; // ✅ FIX
import { generateBpmn } from "./services/bpmnGenerator.js";

const app = express();
const PORT = 5000;

/*
MIDDLEWARE
*/
app.use(cors());
app.use(express.json());

/*
TEST ROUTE
*/
app.get("/", (req, res) => {
    res.send("ProBPM API läuft 🚀");
});

/*
ANALYZE ROUTE
*/
app.post("/analyze", async (req, res) => {
    try {
        const { text } = req.body;

        if (!text) {
            return res.status(400).json({
                error: "Kein Text übergeben"
            });
        }

        console.log("📥 TEXT EMPFANGEN:\n", text);

        /*
        1. KI ANALYSE
        */
        const process = await analyzeText(text); // ✅ FIX

        console.log("🧠 ANALYSE ERGEBNIS:\n", process);

        /*
        2. BPMN GENERATOR
        */
        const xml = await generateBpmn(process);

        console.log("📊 BPMN ERZEUGT");

        /*
        RESPONSE
        */
        res.json({ xml });

    } catch (error) {
        console.error("❌ SERVER ERROR:", error);

        res.status(500).json({
            error: "Server Fehler",
            details: error.message,
            hint: "Check AI response & JSON parsing"
        });
    }
});

/*
SERVER START
*/
app.listen(PORT, () => {
    console.log(`🚀 Server läuft auf http://localhost:${PORT}`);
});