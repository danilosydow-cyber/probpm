import "dotenv/config";

import express from "express";
import cors from "cors";

import { analyzeProcess } from "./services/processAnalyzer.js";
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

        console.log("📥 TEXT EMPFANGEN:");
        console.log(text);

        /*
        1. PROCESS ANALYZER (KI)
        */

        const process = await analyzeProcess(text);

        console.log("🧠 ANALYSE ERGEBNIS:");
        console.log(process);

        /*
        2. BPMN GENERATOR
        */

        const xml = await generateBpmn(process);

        console.log("📊 BPMN ERZEUGT");

        /*
        RESPONSE
        */

        res.json({
            xml
        });

    } catch (error) {
        console.error("❌ FEHLER:", error);

        res.status(500).json({
            error: "Server Fehler",
            details: error.message
        });
    }
});

/*
SERVER START
*/

app.listen(PORT, () => {
    console.log(`🚀 Server läuft auf http://localhost:${PORT}`);
});