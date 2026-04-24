import express from "express";

import { analyzeTextToProcess } from "../services/analyzer.js";
import { generateBPMN } from "../services/bpmnGenerator.js";
import { buildRoutingDebug } from "../services/bpmnRoutingDebug.js";
import { validateTextInput } from "../middleware/validateTextInput.js";

function buildIncrementalProcessModel(processJson, fraction = 1) {
    const sourceSteps = Array.isArray(processJson?.steps) ? processJson.steps : [];
    if (sourceSteps.length <= 1) return processJson;
    const keepCount = Math.max(2, Math.min(sourceSteps.length, Math.floor(sourceSteps.length * fraction)));
    const keepSteps = sourceSteps.slice(0, keepCount);
    const keepIds = new Set(keepSteps.map((step) => step.id));

    const filteredSteps = keepSteps.map((step) => {
        const next = Array.isArray(step?.next) ? step.next.filter((id) => keepIds.has(id)) : [];
        const conditions = Array.isArray(step?.conditions)
            ? step.conditions
                .filter((condition) => keepIds.has(condition?.target))
                .map((condition) => ({ ...condition }))
            : [];
        return {
            ...step,
            next,
            conditions
        };
    });

    return {
        ...processJson,
        steps: filteredSteps
    };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createGenerateRouter({
    analyzeText = analyzeTextToProcess,
    generateBpmn = generateBPMN
} = {}) {
    const router = express.Router();

    // Design-Regel 4: Echtzeit-Visualisierung während der Analyse
    router.post("/", validateTextInput, async (req, res, next) => {
        try {
            const enableRealTime = String(req.query?.realTime || "").toLowerCase() === "true";
            
            // Echtzeit-Modus: Server-Sent Events
            if (enableRealTime) {
                res.writeHead(200, {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                    'Access-Control-Allow-Origin': '*'
                });
                
                const sendUpdate = (type, data) => {
                    res.write(`event: ${type}\n`);
                    res.write(`data: ${JSON.stringify(data)}\n\n`);
                    if (typeof res.flush === "function") {
                        res.flush();
                    }
                };
                
                try {
                    sendUpdate('start', { message: 'Analyse gestartet...', timestamp: Date.now() });
                    
                    // Schritt 1: Textanalyse
                    sendUpdate('progress', { step: 'analyze', message: 'Text wird analysiert...', progress: 10 });
                    const processJson = await analyzeText(req.validatedText, {
                        onProgress: (evt) => {
                            sendUpdate("progress", {
                                step: evt?.step || "analyze_detail",
                                message: evt?.message || "Analyse-Schritt...",
                                progress: 12,
                                data: evt?.data || null
                            });
                        }
                    });
                    sendUpdate('progress', { step: 'analyze_complete', message: 'Textanalyse abgeschlossen', progress: 30, data: { steps: processJson.steps?.length || 0 } });
                    
                    // Schritt 2: BPMN-Generierung
                    sendUpdate('progress', { step: 'generate', message: 'BPMN-Modell wird generiert...', progress: 40 });
                    const previewFractions = [0.35, 0.6, 0.85];
                    for (let idx = 0; idx < previewFractions.length; idx += 1) {
                        const fraction = previewFractions[idx];
                        try {
                            const previewModel = buildIncrementalProcessModel(processJson, fraction);
                            const previewXml = generateBpmn(previewModel);
                            sendUpdate('progress', {
                                step: `generate_preview_${idx + 1}`,
                                message: `Zwischenstand ${idx + 1}/${previewFractions.length} wird aufgebaut...`,
                                progress: 46 + idx * 6,
                                data: {
                                    xml: previewXml,
                                    previewStage: idx + 1
                                }
                            });
                        } catch (_previewErr) {
                            // Ignore preview issues; final generation remains authoritative.
                        }
                        // Let network/client breathe between previews.
                        await sleep(160);
                    }
                    let xml = generateBpmn(processJson);
                    sendUpdate('progress', {
                        step: 'generate_complete',
                        message: 'BPMN-Modell generiert',
                        progress: 85,
                        data: {
                            xml,
                            xmlPreview: xml.substring(0, 500) + '...'
                        }
                    });
                    
                    // Schritt 5: Finalisierung
                    sendUpdate('progress', { step: 'finalizing', message: 'Finalisierung...', progress: 95 });
                    const debugRouting = String(req.query?.debugRouting || "").toLowerCase() === "true";
                    const routingDebug = debugRouting ? buildRoutingDebug(processJson) : null;
                    
                    sendUpdate('complete', {
                        success: true,
                        json: processJson,
                        xml,
                        routingDebug
                    });
                    
                } catch (error) {
                    sendUpdate('error', { 
                        code: "PROCESSING_ERROR", 
                        error: error.message,
                        message: 'Fehler bei der Verarbeitung' 
                    });
                }
                
                res.end();
                return;
            }
            
            // Standard-Modus (ohne Echtzeit)
            const processJson = await analyzeText(req.validatedText);
            const xml = generateBpmn(processJson);
            const debugRouting = String(req.query?.debugRouting || "").toLowerCase() === "true";
            const routingDebug = debugRouting ? buildRoutingDebug(processJson) : null;

            res.json({
                success: true,
                json: processJson,
                xml,
                routingDebug
            });
        } catch (err) {
            next(err);
        }
    });

    return router;
}
