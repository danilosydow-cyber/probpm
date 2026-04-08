import express from "express";
import { analyzeTextToProcess } from "../services/analyzer.js";

const router = express.Router();

router.post("/", async (req, res) => {

    try {
        const { text } = req.body;
        if (typeof text !== "string" || text.trim().length < 5) {
            return res.status(400).json({
                success: false,
                error: "Bitte gib einen Text mit mindestens 5 Zeichen an."
            });
        }

        const process = await analyzeTextToProcess(text.trim());

        res.json({
            success: true,
            json: process
        });

    } catch (err) {
        res.status(500).json({
            success: false,
            error: err?.message || "Interner Serverfehler"
        });
    }
});

export default router;