import OpenAI from "openai";

import { MAX_PROCESS_TEXT_CHARS, MIN_PROCESS_TEXT_CHARS } from "../../constants.js";
import { AppError, badRequest } from "../../utils/apiErrors.js";
import { getBpmnKnowledgeBase } from "../bpmnKnowledgeBase.js";
import { buildLearningGuidanceText } from "../bpmnQualityLearning.js";
import {
    buildAnalyzePrompt,
    buildRepairPrompt,
    buildOptimizationGuidanceFromKnowledgeBase,
    buildOptimizationPrompt
} from "./prompt.js";
import { parseAnalyzerResponse } from "./parseResponse.js";
import { validateProcessShape } from "./validateProcess.js";
import { normalizeProcessJson } from "./normalizeProcess.js";

let openAiClient = null;

function getOpenAiClient() {
    if (openAiClient) return openAiClient;
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
        throw new AppError("OPENAI_API_KEY_MISSING", "OpenAI API Key fehlt", 500);
    }
    openAiClient = new OpenAI({ apiKey });
    return openAiClient;
}

const ANALYZE_TIMEOUT_MS = Number(process.env.ANALYZE_TIMEOUT_MS || 35000);
const OPTIMIZE_TIMEOUT_MS = Number(process.env.OPTIMIZE_TIMEOUT_MS || 20000);
const ANALYZE_MAX_RETRIES = Number(process.env.ANALYZE_MAX_RETRIES || 1);
const ANALYZE_REPAIR_MAX_RETRIES = Number(process.env.ANALYZE_REPAIR_MAX_RETRIES || 1);
const OPTIMIZE_MAX_RETRIES = Number(process.env.OPTIMIZE_MAX_RETRIES || 1);
const AMBIGUITY_FLAGS = Object.freeze({
    MISSING_ROLE: "MISSING_ROLE",
    MULTI_ROLE_STEP: "MULTI_ROLE_STEP",
    UNCLEAR_DECISION: "UNCLEAR_DECISION",
    WEAK_DEPENDENCY: "WEAK_DEPENDENCY",
    MISSING_END_HINT: "MISSING_END_HINT"
});

function normalizeInputForBpmn(text) {
    return String(text || "")
        .replace(/\r\n/g, "\n")
        .replace(/[•·]/g, "-")
        .replace(/[ \t]*([;|])\s*/g, "\n")
        .replace(/[ \t]+/g, " ")
        .replace(/\n{3,}/g, "\n\n")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .join("\n");
}

function normalizeOptimizedTextForBpmn(text) {
    const prepared = normalizeInputForBpmn(text);
    if (!prepared) return "";

    const lines = prepared
        .split("\n")
        .map((line) => line.replace(/\s+/g, " ").trim())
        .filter(Boolean);

    const normalized = lines.map((line, index) => {
        const withColon = line.includes(":")
            ? line
            : (line.toLowerCase().startsWith("schritt ")
                ? line.replace(/^schritt\s+(\d+)\s*/i, "Schritt $1: ")
                : line);
        if (/^schritt\s+\d+:/i.test(withColon)) {
            return withColon
                .replace(/\s*;\s*/g, "; ")
                .replace(/\s*=\s*/g, "=");
        }
        if (/^rollen:/i.test(withColon)) return `Rollen: ${withColon.replace(/^rollen:\s*/i, "")}`;
        if (/^entscheidung\s+\d+:/i.test(withColon)) return withColon;
        if (/^zeitachse:/i.test(withColon)) return withColon;
        return index === 0 ? `Rollen: ${withColon}` : `Schritt ${index}: ${withColon}`;
    });

    return normalized.join("\n");
}

function classifyDecisionLabel(label) {
    const value = String(label || "").trim().toLowerCase();
    if (!value) return "other";
    if (/(^|\b)(ja|yes|ok|true|genehmigt|freigabe)(\b|$)/i.test(value)) return "yes";
    if (/(^|\b)(nein|no|false|abgelehnt)(\b|$)/i.test(value)) return "no";
    if (/(^|\b)(fehler|error|ungueltig|ungültig|fehlend|unvollstaendig|unvollständig)(\b|$)/i.test(value)) return "error";
    return "other";
}

function extractStatusHint(step, sourceText = "") {
    const haystack = [
        String(step?.label || ""),
        String(step?.documentation || ""),
        String(sourceText || "")
    ].join(" ").toLowerCase();
    if (/\b(abgeschlossen|beendet|erledigt)\b/.test(haystack)) return "abgeschlossen";
    if (/\b(freigegeben|genehmigt)\b/.test(haystack)) return "freigegeben";
    if (/\b(in bearbeitung|bearbeitung)\b/.test(haystack)) return "in Bearbeitung";
    if (/\b(geprueft|geprüft|validiert)\b/.test(haystack)) return "geprueft";
    if (/\b(offen|wartet|ausstehend)\b/.test(haystack)) return "offen";
    return "";
}

function sanitizeParsedFlowTargets(processJson) {
    if (!processJson || typeof processJson !== "object") return processJson;
    const steps = Array.isArray(processJson.steps) ? processJson.steps : [];
    const validIds = new Set(
        steps
            .map((step) => String(step?.id || "").trim())
            .filter(Boolean)
    );

    processJson.steps = steps.map((step) => {
        const next = (Array.isArray(step?.next) ? step.next : [])
            .filter((target) => typeof target === "string" && validIds.has(target));
        const conditions = (Array.isArray(step?.conditions) ? step.conditions : [])
            .filter((cond) => typeof cond?.target === "string" && validIds.has(cond.target))
            .map((cond) => ({
                ...cond,
                target: String(cond.target).trim()
            }));
        return {
            ...step,
            next,
            conditions
        };
    });
    return processJson;
}

function emitAnalyzeProgress(onProgress, payload) {
    if (typeof onProgress !== "function") return;
    try {
        onProgress({
            timestamp: Date.now(),
            ...payload
        });
    } catch (_err) {
        // Progress reporting must never break analysis flow.
    }
}

function collectModelingIssues(processJson) {
    const issues = [];
    const steps = Array.isArray(processJson?.steps) ? processJson.steps : [];
    const roleSet = new Set((Array.isArray(processJson?.roles) ? processJson.roles : []).map((r) => String(r || "").trim()));
    const idSet = new Set(steps.map((step) => String(step?.id || "").trim()).filter(Boolean));
    const incomingCount = new Map();

    steps.forEach((step) => {
        (Array.isArray(step?.next) ? step.next : []).forEach((target) => {
            incomingCount.set(target, (incomingCount.get(target) || 0) + 1);
        });
        (Array.isArray(step?.conditions) ? step.conditions : []).forEach((cond) => {
            const target = String(cond?.target || "").trim();
            if (!target) return;
            incomingCount.set(target, (incomingCount.get(target) || 0) + 1);
        });
    });

    steps.forEach((step) => {
        const id = String(step?.id || "").trim();
        const type = String(step?.type || "task").trim().toLowerCase();
        const next = Array.isArray(step?.next) ? step.next : [];
        const conditions = Array.isArray(step?.conditions) ? step.conditions : [];
        const role = String(step?.role || "").trim();

        if (role && !roleSet.has(role)) {
            issues.push(`Step ${id}: Rolle "${role}" ist nicht in roles enthalten`);
        }

        if (type === "gateway") {
            if (conditions.length < 2) {
                issues.push(`Step ${id}: Gateway braucht mindestens 2 Bedingungen`);
            }
            const seenTargets = new Set();
            conditions.forEach((cond, idx) => {
                const label = String(cond?.label || "").trim();
                const target = String(cond?.target || "").trim();
                if (!label) issues.push(`Step ${id}: Bedingung ${idx + 1} hat kein Label`);
                if (!target || !idSet.has(target)) issues.push(`Step ${id}: Bedingung ${idx + 1} zeigt auf ungueltiges Ziel`);
                if (target && seenTargets.has(target)) issues.push(`Step ${id}: mehrere Bedingungen zeigen auf dasselbe Ziel (${target})`);
                if (target) seenTargets.add(target);
            });
            if (next.length > 0) {
                issues.push(`Step ${id}: Gateway darf kein next-Feld mit Kanten haben`);
            }
        } else if (type === "end") {
            if (next.length > 0 || conditions.length > 0) {
                issues.push(`Step ${id}: End Event darf keine ausgehenden Kanten haben`);
            }
        } else {
            if (conditions.length > 0) {
                issues.push(`Step ${id}: Task darf keine conditions enthalten`);
            }
            if (next.length === 0) {
                issues.push(`Step ${id}: Task ohne next-Ziel`);
            }
        }
    });

    const endCount = steps.filter((step) => String(step?.type || "").trim().toLowerCase() === "end").length;
    if (endCount < 1) {
        issues.push("Modell braucht mindestens ein End Event");
    }
    const rootSteps = steps.filter((step) => (incomingCount.get(step?.id) || 0) === 0);
    if (rootSteps.length !== 1) {
        issues.push(`Modell braucht genau einen fachlichen Einstieg (gefunden: ${rootSteps.length})`);
    }

    return [...new Set(issues)];
}

function finalizeAnalyzedProcess(parsed, sourceText = "") {
    sanitizeParsedFlowTargets(parsed);
    prevalidateSemanticProcess(parsed);
    const semanticIR = buildSemanticIRFromProcess(parsed, sourceText);
    const withIR = {
        ...parsed,
        _semanticIR: semanticIR,
        _ambiguityFlags: [
            ...(Array.isArray(semanticIR?.processFlags) ? semanticIR.processFlags : []),
            ...semanticIR.steps.flatMap((step) => step.ambiguityFlags || [])
        ]
    };
    const modelingIssues = collectModelingIssues(withIR);
    if (modelingIssues.length > 0) {
        throw new AppError(
            "MODELING_RULE_VIOLATION",
            modelingIssues.slice(0, 8).join("; "),
            422,
            { issues: modelingIssues }
        );
    }
    validateProcessShape(withIR);
    return normalizeProcessJson(withIR);
}

export function prevalidateSemanticProcess(processJson) {
    if (!processJson || typeof processJson !== "object") {
        throw new AppError("SCHEMA_MISMATCH", "Analyse-Ergebnis hat kein gueltiges Objektformat", 422);
    }
    if (!Array.isArray(processJson.roles) || processJson.roles.length === 0) {
        throw new AppError("SEMANTIC_PREVALIDATION_FAILED", "Keine Rollen im Analyse-Ergebnis", 422);
    }
    if (!Array.isArray(processJson.steps) || processJson.steps.length === 0) {
        throw new AppError("SEMANTIC_PREVALIDATION_FAILED", "Keine Schritte im Analyse-Ergebnis", 422);
    }
    const ids = new Set();
    processJson.steps.forEach((step) => {
        const id = String(step?.id || "").trim();
        if (!id) {
            throw new AppError("SEMANTIC_PREVALIDATION_FAILED", "Schritt ohne gueltige ID", 422);
        }
        if (ids.has(id)) {
            throw new AppError("DUPLICATE_STEP_ID", `Doppelte Step-ID: ${id}`, 422);
        }
        ids.add(id);
    });
    processJson.steps.forEach((step) => {
        (Array.isArray(step?.next) ? step.next : []).forEach((target) => {
            if (typeof target !== "string" || !ids.has(target)) {
                throw new AppError("SEMANTIC_PREVALIDATION_FAILED", `Ungueltiges next-Target: ${String(target || "")}`, 422);
            }
        });
        (Array.isArray(step?.conditions) ? step.conditions : []).forEach((cond) => {
            const target = cond?.target;
            if (typeof target !== "string" || !ids.has(target)) {
                throw new AppError("SEMANTIC_PREVALIDATION_FAILED", `Ungueltiges condition-Target: ${String(target || "")}`, 422);
            }
        });
    });
}

export function buildSemanticIRFromProcess(processJson, sourceText = "") {
    const roles = Array.isArray(processJson?.roles) ? processJson.roles : [];
    const steps = Array.isArray(processJson?.steps) ? processJson.steps : [];
    const stepById = new Map(steps.map((step) => [String(step?.id || ""), step]));
    const incomingByTarget = new Map();
    steps.forEach((step) => {
        const fromId = String(step?.id || "");
        (Array.isArray(step?.next) ? step.next : []).forEach((target) => {
            const list = incomingByTarget.get(target) || [];
            list.push(fromId);
            incomingByTarget.set(target, list);
        });
        (Array.isArray(step?.conditions) ? step.conditions : []).forEach((cond) => {
            const target = String(cond?.target || "");
            if (!target) return;
            const list = incomingByTarget.get(target) || [];
            list.push(fromId);
            incomingByTarget.set(target, list);
        });
    });

    const irSteps = steps.map((step, index) => {
        const type = String(step?.type || "task").toLowerCase();
        const role = String(step?.role || "").trim();
        const conditions = Array.isArray(step?.conditions) ? step.conditions : [];
        const incoming = incomingByTarget.get(step.id) || [];
        const ambiguityFlags = [];

        if (!role) ambiguityFlags.push(AMBIGUITY_FLAGS.MISSING_ROLE);
        if (/[,&/]| und /i.test(role)) ambiguityFlags.push(AMBIGUITY_FLAGS.MULTI_ROLE_STEP);
        if (type === "gateway") {
            const hasQuestionLabel = /\?/.test(String(step?.label || ""));
            const hasDecisionLabels = conditions.some((cond) => classifyDecisionLabel(cond?.label) !== "other");
            if (!hasQuestionLabel && !hasDecisionLabels) {
                ambiguityFlags.push(AMBIGUITY_FLAGS.UNCLEAR_DECISION);
            }
        }
        if (index > 0 && incoming.length === 0 && type !== "start" && type !== "startevent") {
            ambiguityFlags.push(AMBIGUITY_FLAGS.WEAK_DEPENDENCY);
        }

        const statusHint = extractStatusHint(step, sourceText);
        const confidence = Math.max(0.2, Math.min(1, 1 - ambiguityFlags.length * 0.2));
        const dependsOn = incoming.length > 0 ? incoming : (index > 0 ? [steps[index - 1]?.id].filter(Boolean) : []);

        return {
            id: step.id,
            role: role || String(roles[0] || "System"),
            activity: String(step?.label || "").trim(),
            decision: type === "gateway" ? String(step?.label || "").trim() : "",
            statusHint,
            dependsOn,
            confidence: Number(confidence.toFixed(2)),
            ambiguityFlags
        };
    });

    const processFlags = [];
    const hasEndHint = steps.some((step) => String(step?.type || "").toLowerCase() === "end");
    if (!hasEndHint) processFlags.push(AMBIGUITY_FLAGS.MISSING_END_HINT);

    return {
        version: "v1",
        processFlags,
        steps: irSteps
    };
}

async function callChatWithTimeout({
    operation,
    timeoutMs,
    maxRetries,
    model,
    messages,
    temperature = 0
}) {
    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        let timer = null;
        try {
            const timeoutPromise = new Promise((_, reject) => {
                timer = setTimeout(() => {
                    reject(new AppError(
                        `${operation.toUpperCase()}_TIMEOUT`,
                        `${operation} dauerte zu lange`,
                        504,
                        { timeoutMs, attempt: attempt + 1 }
                    ));
                }, timeoutMs);
            });
            const requestPromise = getOpenAiClient().chat.completions.create({
                model,
                temperature,
                messages
            });
            const result = await Promise.race([requestPromise, timeoutPromise]);
            if (timer) clearTimeout(timer);
            return result;
        } catch (error) {
            if (timer) clearTimeout(timer);
            lastError = error;
            const isTimeout = error instanceof AppError && String(error.code).endsWith("_TIMEOUT");
            if (!isTimeout || attempt >= maxRetries) break;
        }
    }
    throw lastError;
}

export async function analyzeTextToProcess(text, options = {}) {
    const onProgress = typeof options?.onProgress === "function" ? options.onProgress : null;
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (!trimmed || trimmed.length < MIN_PROCESS_TEXT_CHARS) {
        throw badRequest("Text zu kurz fuer Analyse", { minLength: MIN_PROCESS_TEXT_CHARS }, "TEXT_TOO_SHORT");
    }
    if (trimmed.length > MAX_PROCESS_TEXT_CHARS) {
        throw badRequest("Text zu lang fuer Analyse", { maxLength: MAX_PROCESS_TEXT_CHARS }, "TEXT_TOO_LONG");
    }

    const learningGuidance = buildLearningGuidanceText();
    const preparedText = normalizeInputForBpmn(trimmed);
    const prompt = buildAnalyzePrompt(preparedText, learningGuidance);
    emitAnalyzeProgress(onProgress, {
        step: "analyze_prepare_input",
        message: "Eingabetext normalisiert"
    });

    try {
        emitAnalyzeProgress(onProgress, {
            step: "analyze_llm_request",
            message: "LLM-Analyse wird ausgefuehrt"
        });
        const response = await callChatWithTimeout({
            operation: "analyze",
            timeoutMs: ANALYZE_TIMEOUT_MS,
            maxRetries: ANALYZE_MAX_RETRIES,
            model: "gpt-4.1",
            temperature: 0,
            messages: [
                {
                    role: "system",
                    content: "Du bist ein extrem praeziser BPMN-Prozess-Parser."
                },
                {
                    role: "user",
                    content: prompt
                }
            ]
        });

        const content = response?.choices?.[0]?.message?.content;
        let parsed = parseAnalyzerResponse(content);
        emitAnalyzeProgress(onProgress, {
            step: "analyze_parse_response",
            message: "LLM-Antwort in JSON geparst"
        });

        for (let repairAttempt = 0; repairAttempt <= ANALYZE_REPAIR_MAX_RETRIES; repairAttempt += 1) {
            try {
                emitAnalyzeProgress(onProgress, {
                    step: "analyze_validate_model",
                    message: repairAttempt > 0
                        ? `Validierung nach Reparatur ${repairAttempt}`
                        : "Struktur- und Modellregeln werden validiert"
                });
                const finalized = finalizeAnalyzedProcess(parsed, preparedText);
                emitAnalyzeProgress(onProgress, {
                    step: "analyze_complete",
                    message: "Analyse-JSON ist gueltig",
                    data: {
                        roles: Array.isArray(finalized?.roles) ? finalized.roles.length : 0,
                        steps: Array.isArray(finalized?.steps) ? finalized.steps.length : 0,
                        repairsUsed: repairAttempt
                    }
                });
                return finalized;
            } catch (validationError) {
                const isLastAttempt = repairAttempt >= ANALYZE_REPAIR_MAX_RETRIES;
                if (isLastAttempt || !(validationError instanceof AppError)) {
                    throw validationError;
                }

                const explicitIssues = Array.isArray(validationError?.details?.issues)
                    ? validationError.details.issues
                    : [];
                const fallbackIssue = `${validationError.code || "VALIDATION_ERROR"}: ${validationError.message || "Unbekannter Fehler"}`;
                const repairPrompt = buildRepairPrompt({
                    sourceText: preparedText,
                    previousJson: parsed,
                    validationErrors: explicitIssues.length > 0 ? explicitIssues : [fallbackIssue],
                    learningGuidance
                });
                emitAnalyzeProgress(onProgress, {
                    step: "analyze_repair_attempt",
                    message: `Reparaturversuch ${repairAttempt + 1} gestartet`,
                    data: {
                        issueCount: explicitIssues.length > 0 ? explicitIssues.length : 1
                    }
                });
                const repairResponse = await callChatWithTimeout({
                    operation: "analyze_repair",
                    timeoutMs: ANALYZE_TIMEOUT_MS,
                    maxRetries: 0,
                    model: "gpt-4.1",
                    temperature: 0,
                    messages: [
                        {
                            role: "system",
                            content: "Du reparierst BPMN-JSON strikt nach Validierungsregeln."
                        },
                        {
                            role: "user",
                            content: repairPrompt
                        }
                    ]
                });
                parsed = parseAnalyzerResponse(repairResponse?.choices?.[0]?.message?.content);
                emitAnalyzeProgress(onProgress, {
                    step: "analyze_repair_complete",
                    message: `Reparaturversuch ${repairAttempt + 1} abgeschlossen`
                });
            }
        }
        throw new AppError("ANALYZE_FAILED", "Analyse fehlgeschlagen", 500);
    } catch (error) {
        if (error instanceof AppError) throw error;
        console.error(error);
        throw new AppError("ANALYZE_FAILED", "Analyse fehlgeschlagen", 500);
    }
}

export async function optimizeProcessText(text) {
    const trimmed = typeof text === "string" ? text.trim() : "";
    if (!trimmed || trimmed.length < MIN_PROCESS_TEXT_CHARS) {
        throw badRequest("Text zu kurz fuer Optimierung", { minLength: MIN_PROCESS_TEXT_CHARS }, "TEXT_TOO_SHORT");
    }
    if (trimmed.length > MAX_PROCESS_TEXT_CHARS) {
        throw badRequest("Text zu lang fuer Optimierung", { maxLength: MAX_PROCESS_TEXT_CHARS }, "TEXT_TOO_LONG");
    }

    const knowledgeBase = getBpmnKnowledgeBase({});
    const guidance = buildOptimizationGuidanceFromKnowledgeBase(knowledgeBase);
    const learningGuidance = buildLearningGuidanceText();
    const mergedGuidance = [guidance, learningGuidance].filter(Boolean).join("\n\n");
    const preparedText = normalizeInputForBpmn(trimmed);
    const prompt = buildOptimizationPrompt(preparedText, mergedGuidance);

    try {
        const response = await callChatWithTimeout({
            operation: "optimize",
            timeoutMs: OPTIMIZE_TIMEOUT_MS,
            maxRetries: OPTIMIZE_MAX_RETRIES,
            model: "gpt-4.1",
            temperature: 0,
            messages: [
                {
                    role: "system",
                    content: "Du optimierst Prozessbeschreibungen fuer robuste BPMN-Erkennung und strukturierst sie klar BPMN-orientiert."
                },
                {
                    role: "user",
                    content: prompt
                }
            ]
        });

        const optimized = normalizeOptimizedTextForBpmn(String(response?.choices?.[0]?.message?.content || "").trim());
        if (!optimized) {
            throw new AppError("OPTIMIZE_EMPTY", "Optimierung lieferte keinen Text", 500);
        }
        return optimized;
    } catch (error) {
        if (error instanceof AppError) throw error;
        console.error(error);
        throw new AppError("OPTIMIZE_FAILED", "Text-Optimierung fehlgeschlagen", 500);
    }
}
