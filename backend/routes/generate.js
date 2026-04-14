import express from "express";

import { analyzeTextToProcess } from "../services/analyzer.js";
import { generateBPMN } from "../services/bpmnGenerator.js";
import { buildRoutingDebug } from "../services/bpmnRoutingDebug.js";
import { recordQualityScorecard } from "../services/bpmnQualityLearning.js";
import { buildBpmnQualityScorecard } from "../services/bpmnQualityScorecard.js";
import { validateTextInput } from "../middleware/validateTextInput.js";

export function createGenerateRouter({
    analyzeText = analyzeTextToProcess,
    generateBpmn = generateBPMN,
    buildScorecard = buildBpmnQualityScorecard,
    recordScorecard = recordQualityScorecard
} = {}) {
    const router = express.Router();
    const needsRelayout = (scorecard = {}) => Boolean(scorecard?.gate?.needsRelayout);
    const isBlockingGate = (scorecard = {}) => Boolean(scorecard?.gate?.blocking);

    router.post("/", validateTextInput, async (req, res, next) => {
        try {
            const strictQualityGate = String(req.query?.strictQualityGate || "").toLowerCase() === "true";
            const processJson = await analyzeText(req.validatedText);
            let xml = generateBpmn(processJson);
            let qualityScorecard = buildScorecard(processJson, { xml });
            let qualityGateStatus = "passed_initial";
            let qualityGateMessage = "";

            if (needsRelayout(qualityScorecard)) {
                const relayoutXml = generateBpmn(processJson, { strictQuality: true });
                const relayoutScorecard = buildScorecard(processJson, { xml: relayoutXml });
                if (!needsRelayout(relayoutScorecard)) {
                    xml = relayoutXml;
                    qualityScorecard = relayoutScorecard;
                    qualityGateStatus = "passed_relayout";
                } else {
                    const debugRouting = String(req.query?.debugRouting || "").toLowerCase() === "true";
                    const routingDebug = debugRouting ? buildRoutingDebug(processJson) : null;
                    qualityGateStatus = "failed_after_relayout";
                    qualityGateMessage = isBlockingGate(relayoutScorecard)
                        ? "Layout-Qualitaetsgrenzen verletzt (outOfWorkspace/avoidableCrossings/flowShapeOverlaps)."
                        : "Best-effort Modell ausgegeben: nicht-blockierende Layoutwarnungen nach Relayout verbleiben.";
                    xml = relayoutXml;
                    qualityScorecard = relayoutScorecard;
                    if (strictQualityGate && isBlockingGate(qualityScorecard)) {
                        return res.status(422).json({
                            success: false,
                            code: "QUALITY_GATE_FAILED",
                            error: qualityGateMessage,
                            message: qualityGateMessage,
                            json: processJson,
                            xml,
                            qualityScorecard,
                            routingDebug,
                            qualityGateStatus
                        });
                    }
                }
            }
            const learningState = recordScorecard(qualityScorecard);
            const debugRouting = String(req.query?.debugRouting || "").toLowerCase() === "true";
            const routingDebug = debugRouting ? buildRoutingDebug(processJson) : null;

            res.json({
                success: true,
                json: processJson,
                xml,
                qualityScorecard,
                routingDebug,
                qualityGateStatus,
                qualityGateMessage: qualityGateMessage || undefined,
                learning: {
                    totalModelsEvaluated: learningState.totalModelsEvaluated,
                    recentScores: Array.isArray(learningState.recentScores) ? learningState.recentScores.slice(0, 5) : []
                }
            });
        } catch (err) {
            next(err);
        }
    });

    return router;
}
