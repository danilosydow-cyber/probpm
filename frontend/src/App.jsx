import BpmnModeler from "bpmn-js/lib/Modeler";
import { useState, useEffect, useRef, useMemo } from "react";
import { jsPDF } from "jspdf";
import { svg2pdf } from "svg2pdf.js";
import mammoth from "mammoth";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "./App.css";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";
import { customPaletteModule } from "./bpmn/customPaletteProvider";
import { customTranslateModule } from "./bpmn/customTranslateModule";
import appLogo from "./assets/probpm-logo.png";

GlobalWorkerOptions.workerSrc = pdfWorker;

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

const COLOR_BY_CATEGORY = {
    roles: { fill: "#E8F5E9", stroke: "#2E7D32" },
    activities: { fill: "#E3F2FD", stroke: "#1565C0" },
    gateways: { fill: "#FFF9C4", stroke: "#F9A825" },
    resources: { fill: "#F3E5F5", stroke: "#7B1FA2" }
};

const ACTIVITY_TYPES = new Set([
    "bpmn:Task",
    "bpmn:UserTask",
    "bpmn:ManualTask",
    "bpmn:ScriptTask",
    "bpmn:BusinessRuleTask",
    "bpmn:SendTask",
    "bpmn:ReceiveTask",
    "bpmn:SubProcess",
    "bpmn:CallActivity"
]);
const SPECIALIZED_TASK_TYPES = new Set([
    "bpmn:UserTask",
    "bpmn:ManualTask",
    "bpmn:ScriptTask",
    "bpmn:BusinessRuleTask",
    "bpmn:SendTask",
    "bpmn:ReceiveTask",
    "bpmn:ServiceTask"
]);

const ROLE_TYPES = new Set(["bpmn:Participant", "bpmn:Lane"]);
const RESOURCE_TYPES = new Set(["bpmn:DataObjectReference", "bpmn:DataStoreReference", "bpmn:DataStore"]);
const GERMAN_STOPWORDS = new Set([
    "der", "die", "das", "den", "dem", "des", "ein", "eine", "einer", "eines", "einem", "einen",
    "und", "oder", "aber", "sonst", "wenn", "falls", "ist", "sind", "war", "waren", "wird", "werden",
    "wurde", "wurden", "hat", "haben", "hatte", "hatten", "sein", "bin", "bist", "seid", "am", "im",
    "in", "an", "auf", "zu", "mit", "von", "für", "bei", "als", "auch", "noch", "nur",
    "er", "sie", "es", "wir", "ihr", "ich", "du", "man", "mich", "dich", "sich", "uns", "euch",
    "mein", "dein", "sein", "ihr", "unser", "euer", "kein", "keine", "nicht"
]);

const isBpmnType = (element, bpmnType) => element?.businessObject?.$instanceOf?.(bpmnType);
const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
const escapeRegExp = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tokenizeWords = (input) => String(input || "").match(/[\p{L}][\p{L}\p{N}-]*/gu) || [];
const normalizeWord = (word) => String(word || "").toLowerCase().trim();
const parseSseEventChunk = (rawChunk = "") => {
    const lines = String(rawChunk || "").split(/\r?\n/);
    let event = "message";
    const dataLines = [];
    lines.forEach((line) => {
        if (line.startsWith("event:")) {
            event = line.slice(6).trim() || "message";
            return;
        }
        if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
        }
    });
    if (dataLines.length === 0) return null;
    const dataRaw = dataLines.join("\n");
    try {
        return { event, data: JSON.parse(dataRaw) };
    } catch {
        return { event, data: { message: dataRaw } };
    }
};

const getStemFromVerbLikeTerm = (word) => normalizeWord(word)
    .replace(/(ieren|ern|eln|en|n)$/u, "")
    .replace(/(test|tet|ten|te|st|t)$/u, "");

const buildVerbVariants = (word) => {
    const normalized = normalizeWord(word);
    if (!normalized || normalized.length < 3) return [];

    const variants = new Set([normalized]);
    const stem = getStemFromVerbLikeTerm(normalized);
    if (stem.length >= 4) {
        variants.add(stem);

        const suffixes = ["t", "te", "ten", "tet", "ter", "tes", "en", "end", "ung"];
        suffixes.forEach((suffix) => variants.add(`${stem}${suffix}`));

        const separablePrefixes = ["zurueck", "zurück", "weiter", "ab", "an", "auf", "aus", "bei", "ein", "mit", "nach", "vor", "zu"];
        const prefix = separablePrefixes.find((candidate) => stem.startsWith(candidate) && stem.length > candidate.length + 2);
        if (prefix) {
            const base = stem.slice(prefix.length);
            variants.add(`${prefix}ge${base}t`);
        } else {
            variants.add(`ge${stem}t`);
        }
    }

    return Array.from(variants);
};

const getColorByElement = (element) => {
    const type = element?.type;
    if (!type) return null;

    if (ROLE_TYPES.has(type) || isBpmnType(element, "bpmn:Participant") || isBpmnType(element, "bpmn:Lane")) {
        return COLOR_BY_CATEGORY.roles;
    }

    if (type.includes("Gateway") || isBpmnType(element, "bpmn:Gateway")) {
        return COLOR_BY_CATEGORY.gateways;
    }

    if (
        RESOURCE_TYPES.has(type)
        || isBpmnType(element, "bpmn:DataObjectReference")
        || isBpmnType(element, "bpmn:DataStoreReference")
        || isBpmnType(element, "bpmn:DataStore")
    ) {
        return COLOR_BY_CATEGORY.resources;
    }

    if (
        ACTIVITY_TYPES.has(type)
        || type.endsWith("Task")
        || isBpmnType(element, "bpmn:Activity")
    ) {
        return COLOR_BY_CATEGORY.activities;
    }

    return null;
};

function App() {
    const [text, setText] = useState("");
    const [xml, setXml] = useState("");
    const [json, setJson] = useState(null);
    const [error, setError] = useState("");
    const [warning, setWarning] = useState("");
    const [status, setStatus] = useState("Bereit");
    const [isLoading, setIsLoading] = useState(false);
    const [showDownloadOptions, setShowDownloadOptions] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [isExtractingDocument, setIsExtractingDocument] = useState(false);
    const [isDragOverEditor, setIsDragOverEditor] = useState(false);
    const [useAiOptimization, setUseAiOptimization] = useState(true);
    const [optimizedInputPreview, setOptimizedInputPreview] = useState("");
    const [showRoutingDebug, setShowRoutingDebug] = useState(false);
    const [allocationSearch, setAllocationSearch] = useState("");
    const [allocationElementFilter, setAllocationElementFilter] = useState("all");
    const [allocationSortBy, setAllocationSortBy] = useState("source");

    const containerRef = useRef(null);
    const paletteHostRef = useRef(null);
    const modelerRef = useRef(null);
    const textAreaRef = useRef(null);
    const highlightRef = useRef(null);
    const lineNumbersRef = useRef(null);
    const activePaletteEntryRef = useRef(null);
    const coloringListenersBoundRef = useRef(false);
    const fileInputRef = useRef(null);

    const attachPalette = () => {
        if (!containerRef.current || !paletteHostRef.current) return;
        const paletteEl = containerRef.current.querySelector(".djs-palette");
        if (paletteEl && !paletteHostRef.current.contains(paletteEl)) {
            paletteHostRef.current.appendChild(paletteEl);
        }
    };

    const clearActivePaletteEntry = () => {
        if (!activePaletteEntryRef.current) return;
        activePaletteEntryRef.current.classList.remove("palette-entry-active");
        activePaletteEntryRef.current = null;
    };

    const setupPaletteInteraction = () => {
        if (!paletteHostRef.current) return;
        const paletteEntries = paletteHostRef.current.querySelector(".djs-palette-entries");
        if (!paletteEntries || paletteEntries.dataset.interactionBound === "true") return;

        paletteEntries.dataset.interactionBound = "true";
        paletteEntries.addEventListener("click", (event) => {
            const entry = event.target.closest(".entry");
            if (!entry) return;

            clearActivePaletteEntry();
            entry.classList.add("palette-entry-active", "palette-entry-click");
            activePaletteEntryRef.current = entry;

            window.setTimeout(() => {
                entry.classList.remove("palette-entry-click");
            }, 220);
        });
    };

    const applyPaletteGroupLabels = () => {
        if (!paletteHostRef.current) return;
        const entriesContainer = paletteHostRef.current.querySelector(".djs-palette-entries");
        if (!entriesContainer) return;

        const categoryConfig = {
            system: { label: "System", order: 1 },
            tools: { label: "Tools", order: 2 },
            activities: { label: "Aktivitäten", order: 3 },
            gateways: { label: "Gateways", order: 4 },
            roles: { label: "Rollen", order: 5 },
            resources: { label: "Ressourcen", order: 6 }
        };

        const sortSystemEntries = (group) => {
            const priority = [
                "bpmn-icon-start-event",
                "bpmn-icon-intermediate-event-catch-timer",
                "bpmn-icon-intermediate-event-catch-message",
                "bpmn-icon-intermediate-event-catch-signal",
                "bpmn-icon-intermediate-event-none",
                "bpmn-icon-end-event-message",
                "bpmn-icon-end-event-terminate",
                "bpmn-icon-group"
            ];
            const entries = Array.from(group.querySelectorAll(".entry"));
            entries
                .map((entry) => {
                    const idx = priority.findIndex((marker) => entry.className.includes(marker));
                    return { entry, idx: idx === -1 ? 999 : idx };
                })
                .sort((a, b) => a.idx - b.idx)
                .forEach(({ entry }) => group.appendChild(entry));
        };

        const classifyEntry = (entry) => {
            const cls = entry.className || "";

            if (cls.includes("palette-system")) return "system";
            if (cls.includes("palette-activity")) return "activities";
            if (cls.includes("palette-gateway")) return "gateways";
            if (cls.includes("palette-role")) return "roles";
            if (cls.includes("palette-resource")) return "resources";

            if (
                cls.includes("bpmn-icon-start-event")
                || cls.includes("bpmn-icon-end-event")
                || cls.includes("bpmn-icon-intermediate-event")
                || cls.includes("bpmn-icon-boundary-event")
                || cls.includes("bpmn-icon-group")
            ) {
                return "system";
            }

            return "tools";
        };

        const visibleEntries = Array.from(entriesContainer.querySelectorAll(".entry"))
            .filter((entry) => window.getComputedStyle(entry).display !== "none");

        if (visibleEntries.length === 0) {
            return;
        }

        const entriesByCategory = new Map();
        Object.keys(categoryConfig).forEach((key) => entriesByCategory.set(key, []));

        visibleEntries.forEach((entry) => {
            const category = classifyEntry(entry);
            if (!entriesByCategory.has(category)) {
                entriesByCategory.set(category, []);
            }
            entriesByCategory.get(category).push(entry);
        });

        entriesContainer.querySelectorAll(".group").forEach((group) => group.remove());

        Object.entries(categoryConfig)
            .sort((a, b) => a[1].order - b[1].order)
            .forEach(([categoryKey, meta]) => {
                const entries = entriesByCategory.get(categoryKey) || [];
                if (entries.length === 0) return;

                const group = document.createElement("div");
                group.className = "group palette-group-labeled";
                group.setAttribute("data-category-label", meta.label);
                group.setAttribute("data-category-key", categoryKey);

                entries.forEach((entry) => group.appendChild(entry));

                if (categoryKey === "system") {
                    sortSystemEntries(group);
                }

                entriesContainer.appendChild(group);
            });
    };

    const applyElementColor = (element) => {
        if (!modelerRef.current || !element) return;
        const modeling = modelerRef.current.get("modeling");
        const color = getColorByElement(element);
        const di = element?.di;
        const currentFill = di?.fill ?? di?.get?.("fill");
        const currentStroke = di?.stroke ?? di?.get?.("stroke");
        const needsUpdate = color && (currentFill !== color.fill || currentStroke !== color.stroke);
        if (needsUpdate) {
            modeling.setColor([element], color);
        }
    };

    const enforceNeutralTaskType = (element) => {
        if (!modelerRef.current || !element?.type) return;
        if (!SPECIALIZED_TASK_TYPES.has(element.type)) return;
        const bpmnReplace = modelerRef.current.get("bpmnReplace");
        if (!bpmnReplace) return;
        bpmnReplace.replaceElement(element, { type: "bpmn:Task" });
    };

    const applyElementColors = () => {
        if (!modelerRef.current) return;
        const elementRegistry = modelerRef.current.get("elementRegistry");

        elementRegistry.forEach((element) => {
            enforceNeutralTaskType(element);
            applyElementColor(element);
        });
    };

    const bindColoringListeners = () => {
        if (!modelerRef.current || coloringListenersBoundRef.current) return;
        coloringListenersBoundRef.current = true;

        const eventBus = modelerRef.current.get("eventBus");
        const scheduleApplyColor = (element) => {
            if (!element) return;
            window.setTimeout(() => applyElementColor(element), 0);
        };

        eventBus.on("commandStack.shape.create.postExecuted", ({ context }) => {
            enforceNeutralTaskType(context?.shape);
            scheduleApplyColor(context?.shape);
            clearActivePaletteEntry();
        });
        eventBus.on("commandStack.shape.append.postExecuted", ({ context }) => {
            enforceNeutralTaskType(context?.shape);
            scheduleApplyColor(context?.shape);
            clearActivePaletteEntry();
        });
        eventBus.on("commandStack.elements.create.postExecuted", ({ context }) => {
            (context?.elements || []).forEach((element) => {
                enforceNeutralTaskType(element);
                scheduleApplyColor(element);
            });
            clearActivePaletteEntry();
        });
        eventBus.on("commandStack.shape.replace.postExecuted", ({ context }) => {
            enforceNeutralTaskType(context?.newShape);
            scheduleApplyColor(context?.newShape);
        });
    };

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const modeler = new BpmnModeler({
            container,
            additionalModules: [customPaletteModule, customTranslateModule]
        });
        modelerRef.current = modeler;

        let cancelled = false;

        modeler
            .createDiagram()
            .then(() => {
                if (cancelled) return;
                attachPalette();
                setupPaletteInteraction();
                applyPaletteGroupLabels();
                applyElementColors();
                bindColoringListeners();
                modeler.get("canvas").zoom("fit-viewport");
            })
            .catch((err) => {
                if (!cancelled) {
                    console.error("BPMN Init Fehler:", err);
                }
            });

        return () => {
            cancelled = true;
            coloringListenersBoundRef.current = false;
            if (modelerRef.current === modeler) {
                modeler.destroy();
                modelerRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        if (!xml) return;
        const modeler = modelerRef.current;
        if (!modeler) return;

        let cancelled = false;

        modeler
            .importXML(xml)
            .then(() => {
                if (cancelled) return;
                attachPalette();
                setupPaletteInteraction();
                applyPaletteGroupLabels();
                applyElementColors();
                modeler.get("canvas").zoom("fit-viewport");
            })
            .catch((err) => {
                if (!cancelled) {
                    console.error("BPMN Fehler:", err);
                }
            });

        return () => {
            cancelled = true;
        };
    }, [xml]);

    const runAnalysis = async (inputText) => {
        const trimmedText = String(inputText || "").trim();
        if (trimmedText.length < 5) {
            setError("Bitte gib mindestens 5 Zeichen ein.");
            return;
        }

        setError("");
        setWarning("");
        setShowDownloadOptions(true);
        setStatus(useAiOptimization ? "Optimiere Text fuer KI-Analyse..." : "Analysiere Prozess...");
        setIsLoading(true);
        try {
            let analysisText = trimmedText;
            if (useAiOptimization) {
                try {
                    const optimizeRes = await fetch(`${API_BASE_URL}/api/optimize`, {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        body: JSON.stringify({ text: trimmedText })
                    });
                    const optimizeData = await optimizeRes.json();
                    if (optimizeRes.ok && optimizeData.success && optimizeData.optimizedText) {
                        analysisText = String(optimizeData.optimizedText).trim();
                        setOptimizedInputPreview(analysisText);
                        setStatus("Text optimiert. Analysiere Prozess...");
                    } else {
                        setOptimizedInputPreview("");
                        setStatus("KI-Optimierung nicht verfuegbar. Analysiere Originaltext...");
                    }
                } catch (_err) {
                    setOptimizedInputPreview("");
                    setStatus("KI-Optimierung nicht erreichbar. Analysiere Originaltext...");
                }
            } else {
                setOptimizedInputPreview("");
            }

            const params = new URLSearchParams({
                realTime: "true"
            });
            if (showRoutingDebug) {
                params.set("debugRouting", "true");
            }
            const res = await fetch(`${API_BASE_URL}/api/generate?${params.toString()}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ text: analysisText })
            });
            if (!res.ok) {
                const fallback = await res.json().catch(() => ({}));
                throw new Error(String(fallback?.error || fallback?.message || "Unbekannter Fehler bei der Analyse."));
            }
            if (!res.body) {
                throw new Error("Streaming-Antwort konnte nicht gelesen werden.");
            }

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let completed = false;

            while (!completed) {
                const { value, done } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                const chunks = buffer.split("\n\n");
                buffer = chunks.pop() || "";

                for (const chunk of chunks) {
                    const parsed = parseSseEventChunk(chunk);
                    if (!parsed) continue;
                    const { event, data } = parsed;

                    if (event === "start") {
                        setStatus(String(data?.message || "Analyse gestartet..."));
                        continue;
                    }
                    if (event === "progress") {
                        const msg = String(data?.message || "Berechne...");
                        setStatus(msg);
                        if (typeof data?.data?.xml === "string" && data.data.xml.trim()) {
                            setXml(String(data.data.xml));
                            // Ensure progressive imports are visually noticeable.
                            // This prevents React from collapsing multiple XML updates into one frame.
                            await new Promise((resolve) => window.setTimeout(resolve, 120));
                        }
                        continue;
                    }
                    if (event === "complete") {
                        completed = true;
                        if (data?.success) {
                            setJson(data.json);
                            setXml(data.xml);
                            setWarning("");
                            setStatus("Analyse erfolgreich.");
                        }
                        continue;
                    }
                    if (event === "error") {
                        completed = true;
                        const backendMessage = data?.error || data?.message || "Unbekannter Fehler bei der Analyse.";
                        const backendCode = String(data?.code || "").trim();
                        setWarning("");
                        setError(backendCode ? `${backendCode}: ${backendMessage}` : backendMessage);
                        setStatus("Analyse fehlgeschlagen.");
                    }
                }
            }

            if (!completed) {
                throw new Error("Streaming wurde unerwartet beendet.");
            }

        } catch (err) {
            console.error(err);
            setWarning("");
            setError(`Backend nicht erreichbar unter ${API_BASE_URL}.`);
            setStatus("Backend nicht erreichbar.");
        } finally {
            setIsLoading(false);
        }
    };

    const handleAnalyze = async () => {
        await runAnalysis(text);
    };

    const relayoutCurrentDiagram = async () => {
        const modeler = modelerRef.current;
        if (!modeler) return false;

        const elementRegistry = modeler.get("elementRegistry");
        const modeling = modeler.get("modeling");

        const lanes = [];
        const sequenceFlows = [];
        const nodes = [];

        elementRegistry.forEach((element) => {
            if (!element || element.labelTarget) return;
            if (isBpmnType(element, "bpmn:Lane")) {
                lanes.push(element);
                return;
            }
            if (isBpmnType(element, "bpmn:SequenceFlow")) {
                sequenceFlows.push(element);
                return;
            }
            if (
                isBpmnType(element, "bpmn:Activity")
                || isBpmnType(element, "bpmn:Gateway")
                || isBpmnType(element, "bpmn:Event")
            ) {
                nodes.push(element);
            }
        });

        if (lanes.length === 0 || nodes.length === 0) return false;

        const laneRows = lanes
            .map((lane) => ({ lane, y: lane.y, h: lane.height }))
            .sort((a, b) => a.y - b.y);

        const laneNodes = new Map(laneRows.map(({ lane }) => [lane.id, []]));
        const laneByNodeId = new Map();
        nodes.forEach((node) => {
            const centerY = node.y + node.height / 2;
            const row = laneRows.find(({ y, h }) => centerY >= y && centerY <= y + h);
            if (!row) return;
            laneNodes.get(row.lane.id).push(node);
            laneByNodeId.set(node.id, row.lane);
        });

        const branchOffsetByTarget = new Map();
        sequenceFlows.forEach((flow) => {
            const source = flow.source;
            const target = flow.target;
            if (!source || !target) return;
            if (!isBpmnType(source, "bpmn:Gateway")) return;
            const srcLane = laneByNodeId.get(source.id);
            const tgtLane = laneByNodeId.get(target.id);
            if (!srcLane || !tgtLane || srcLane.id !== tgtLane.id) return;
            const key = source.id;
            if (!branchOffsetByTarget.has(key)) {
                branchOffsetByTarget.set(key, new Map());
            }
            const branchMap = branchOffsetByTarget.get(key);
            if (branchMap.has(target.id)) return;
            const idx = branchMap.size;
            const offset = idx === 0 ? 0 : (idx % 2 === 1 ? 1 : -1) * Math.ceil(idx / 2) * 84;
            branchMap.set(target.id, offset);
        });

        const targetPosById = new Map();
        const LANE_PADDING = 18;
        const BRANCH_VERTICAL_OFFSET = 120;
        laneRows.forEach(({ lane, y, h }) => {
            const laneCenterY = y + h / 2;
            const rowNodes = laneNodes.get(lane.id) || [];
            rowNodes.forEach((node) => {
                const baseY = laneCenterY - node.height / 2;
                let branchOffset = 0;
                sequenceFlows.forEach((flow) => {
                    if (flow.target?.id !== node.id) return;
                    const branchMap = branchOffsetByTarget.get(flow.source?.id);
                    if (!branchMap) return;
                    if (branchMap.has(node.id)) {
                        branchOffset = branchMap.get(node.id);
                    }
                });
                const isGateway = isBpmnType(node, "bpmn:Gateway");
                const minY = y + LANE_PADDING;
                const maxY = y + h - LANE_PADDING - node.height;
                const effectiveBranchOffset = Math.max(
                    -BRANCH_VERTICAL_OFFSET * 2,
                    Math.min(BRANCH_VERTICAL_OFFSET * 2, branchOffset)
                );
                const targetY = Math.max(minY, Math.min(maxY, isGateway ? baseY : baseY + effectiveBranchOffset));
                targetPosById.set(node.id, { x: node.x, y: targetY });
            });

            const byRow = new Map();
            rowNodes.forEach((node) => {
                const pos = targetPosById.get(node.id);
                if (!pos) return;
                const rowKey = Math.round((pos.y + node.height / 2) / 36);
                if (!byRow.has(rowKey)) byRow.set(rowKey, []);
                byRow.get(rowKey).push(node);
            });

            byRow.forEach((bucketNodes) => {
                bucketNodes.sort((a, b) => (targetPosById.get(a.id)?.x || a.x) - (targetPosById.get(b.id)?.x || b.x));
                for (let i = 1; i < bucketNodes.length; i += 1) {
                    const prev = bucketNodes[i - 1];
                    const curr = bucketNodes[i];
                    const prevPos = targetPosById.get(prev.id);
                    const currPos = targetPosById.get(curr.id);
                    if (!prevPos || !currPos) continue;
                    const minX = prevPos.x + prev.width + 44;
                    if (currPos.x < minX) {
                        currPos.x = minX;
                    }
                }
            });

            // Hard collision resolver per lane: ensure node rectangles do not overlap.
            const lanePlaced = rowNodes
                .map((node) => ({ node, pos: targetPosById.get(node.id) }))
                .filter(({ pos }) => Boolean(pos));
            const overlaps = (a, b, margin = 10) => (
                a.x < (b.x + b.w + margin)
                && (a.x + a.w + margin) > b.x
                && a.y < (b.y + b.h + margin)
                && (a.y + a.h + margin) > b.y
            );

            for (let pass = 0; pass < 8; pass += 1) {
                let changed = false;
                for (let i = 0; i < lanePlaced.length; i += 1) {
                    for (let j = i + 1; j < lanePlaced.length; j += 1) {
                        const a = lanePlaced[i];
                        const b = lanePlaced[j];
                        const aRect = { x: a.pos.x, y: a.pos.y, w: a.node.width, h: a.node.height };
                        const bRect = { x: b.pos.x, y: b.pos.y, w: b.node.width, h: b.node.height };
                        if (!overlaps(aRect, bRect)) continue;

                        // Prefer vertical separation inside lane; fallback to horizontal push.
                        const laneMinY = y + LANE_PADDING;
                        const laneMaxYForB = y + h - LANE_PADDING - b.node.height;
                        const laneMaxYForA = y + h - LANE_PADDING - a.node.height;
                        const moveDown = Math.max(18, (aRect.y + aRect.h + 12) - bRect.y);
                        const canMoveBDown = b.pos.y + moveDown <= laneMaxYForB;
                        const canMoveAUp = a.pos.y - moveDown >= laneMinY;

                        if (canMoveBDown) {
                            b.pos.y += moveDown;
                            changed = true;
                        } else if (canMoveAUp) {
                            a.pos.y -= moveDown;
                            changed = true;
                        } else if (a.pos.y + a.node.height / 2 <= b.pos.y + b.node.height / 2) {
                            b.pos.x = Math.max(b.pos.x, a.pos.x + a.node.width + 52);
                            changed = true;
                        } else {
                            a.pos.x = Math.max(a.pos.x, b.pos.x + b.node.width + 52);
                            if (a.pos.y > laneMaxYForA) a.pos.y = laneMaxYForA;
                            changed = true;
                        }
                    }
                }
                if (!changed) break;
            }
        });

        const movable = nodes.filter((node) => targetPosById.has(node.id));
        movable.forEach((node) => {
            const target = targetPosById.get(node.id);
            const dx = Math.round(target.x - node.x);
            const dy = Math.round(target.y - node.y);
            if (dx !== 0 || dy !== 0) {
                modeling.moveElements([node], { x: dx, y: dy });
            }
        });

        modeler.get("canvas").zoom("fit-viewport");
        return movable.length > 0;
    };

    const handleRelayout = async () => {
        setError("");
        setWarning("");
        setStatus("Ordne Elemente neu an...");
        const relayoutDone = await relayoutCurrentDiagram();
        if (relayoutDone) {
            setStatus("Layout erfolgreich neu angeordnet.");
            return;
        }
        const trimmedText = String(text || "").trim();
        if (trimmedText.length < 5) {
            setError("Für Neu-Anordnung bitte zuerst einen Prozess-Text eingeben.");
            setStatus("Neu-Anordnung fehlgeschlagen.");
            return;
        }
        await runAnalysis(trimmedText);
    };

    const extractTextFromPdf = async (file) => {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await getDocument({ data: arrayBuffer }).promise;
        const pages = [];

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum += 1) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            const pageText = textContent.items
                .map((item) => (typeof item.str === "string" ? item.str : ""))
                .join(" ")
                .replace(/\s+/g, " ")
                .trim();
            if (pageText) {
                pages.push(pageText);
            }
        }

        return pages.join("\n\n");
    };

    const extractTextFromDocx = async (file) => {
        const arrayBuffer = await file.arrayBuffer();
        const result = await mammoth.extractRawText({ arrayBuffer });
        return (result.value || "").replace(/\r/g, "").trim();
    };

    const extractTextFromPlainFile = async (file) => {
        return (await file.text()).replace(/\r/g, "").trim();
    };

    const processUploadedFile = async (file) => {
        if (!file) return;

        const fileName = file.name || "Dokument";
        const lowerName = fileName.toLowerCase();
        setError("");
        setIsExtractingDocument(true);
        setStatus(`Extrahiere Text aus ${fileName}...`);

        try {
            let extractedText = "";

            if (lowerName.endsWith(".pdf")) {
                extractedText = await extractTextFromPdf(file);
            } else if (lowerName.endsWith(".docx")) {
                extractedText = await extractTextFromDocx(file);
            } else if (
                lowerName.endsWith(".txt")
                || lowerName.endsWith(".md")
                || lowerName.endsWith(".json")
                || lowerName.endsWith(".csv")
            ) {
                extractedText = await extractTextFromPlainFile(file);
            } else {
                throw new Error("Nicht unterstütztes Dateiformat. Bitte PDF, DOCX, TXT, MD, CSV oder JSON verwenden.");
            }

            if (!extractedText || extractedText.trim().length === 0) {
                throw new Error("Es konnte kein Text aus dem Dokument extrahiert werden.");
            }

            setText(extractedText);
            setStatus(`Text aus ${fileName} erfolgreich geladen.`);
            await runAnalysis(extractedText);
        } catch (err) {
            setError(err?.message || "Dokument konnte nicht verarbeitet werden.");
            setWarning("");
            setStatus("Dokument-Extraktion fehlgeschlagen.");
        } finally {
            setIsExtractingDocument(false);
        }
    };

    const handleUploadDocument = async (event) => {
        const file = event.target.files?.[0];
        await processUploadedFile(file);
        if (event.target) {
            event.target.value = "";
        }
    };

    const handleEditorDragOver = (event) => {
        event.preventDefault();
        setIsDragOverEditor(true);
    };

    const handleEditorDragLeave = (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
            setIsDragOverEditor(false);
        }
    };

    const handleEditorDrop = async (event) => {
        event.preventDefault();
        setIsDragOverEditor(false);
        const file = event.dataTransfer?.files?.[0];
        if (file) {
            await processUploadedFile(file);
        }
    };

    const triggerDownload = (blob, fileName) => {
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    };

    const getCurrentBpmnXml = async () => {
        if (!modelerRef.current) {
            throw new Error("Editor ist noch nicht initialisiert.");
        }
        const { xml: latestXml } = await modelerRef.current.saveXML({ format: true });
        return latestXml;
    };

    const getCurrentSvg = async () => {
        if (!modelerRef.current) {
            throw new Error("Editor ist noch nicht initialisiert.");
        }
        const { svg } = await modelerRef.current.saveSVG();
        return svg;
    };

    const handleDownloadBpmn = async () => {
        try {
            setError("");
            setIsExporting(true);
            const latestXml = await getCurrentBpmnXml();
            triggerDownload(new Blob([latestXml], { type: "application/xml" }), "prozessmodell.bpmn");
            setStatus("BPMN-Datei wurde heruntergeladen.");
        } catch (err) {
            setError(err?.message || "BPMN-Export fehlgeschlagen.");
            setWarning("");
            setStatus("BPMN-Export fehlgeschlagen.");
        } finally {
            setIsExporting(false);
        }
    };

    const handleDownloadSvg = async () => {
        try {
            setError("");
            setIsExporting(true);
            const svg = await getCurrentSvg();
            triggerDownload(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }), "prozessmodell.svg");
            setStatus("SVG-Datei wurde heruntergeladen.");
        } catch (err) {
            setError(err?.message || "SVG-Export fehlgeschlagen.");
            setWarning("");
            setStatus("SVG-Export fehlgeschlagen.");
        } finally {
            setIsExporting(false);
        }
    };

    const handleDownloadPdf = async () => {
        try {
            setError("");
            setIsExporting(true);
            const svgMarkup = await getCurrentSvg();
            const svgDoc = new DOMParser().parseFromString(svgMarkup, "image/svg+xml");
            const svgElement = svgDoc.documentElement;

            const viewBox = (svgElement.getAttribute("viewBox") || "0 0 1200 800")
                .split(/\s+/)
                .map((value) => Number(value) || 0);
            const width = viewBox[2] > 0 ? viewBox[2] : 1200;
            const height = viewBox[3] > 0 ? viewBox[3] : 800;

            const pdf = new jsPDF({
                orientation: width >= height ? "landscape" : "portrait",
                unit: "pt",
                format: [width, height]
            });

            await svg2pdf(svgElement, pdf, {
                x: 0,
                y: 0,
                width,
                height
            });

            triggerDownload(pdf.output("blob"), "prozessmodell.pdf");
            setStatus("PDF-Datei wurde heruntergeladen.");
        } catch (err) {
            setError(err?.message || "PDF-Export fehlgeschlagen.");
            setWarning("");
            setStatus("PDF-Export fehlgeschlagen.");
        } finally {
            setIsExporting(false);
        }
    };

    const processWordCount = useMemo(() => {
        return text
            .split(/\s+/)
            .map((token) => token.trim().toLowerCase().replace(/[^\p{L}\p{N}-]/gu, ""))
            .filter((token) => token.length >= 2)
            .filter((token) => !GERMAN_STOPWORDS.has(token))
            .length;
    }, [text]);

    const totalWordCount = useMemo(() => {
        return text
            .split(/\s+/)
            .map((token) => token.trim())
            .filter((token) => token.length > 0)
            .length;
    }, [text]);

    const textLineCount = useMemo(() => {
        return Math.max(6, text.split(/\r?\n/).length);
    }, [text]);

    const rolesCount = useMemo(() => {
        const roles = json?.roles;
        return Array.isArray(roles) ? roles.length : 0;
    }, [json]);

    const activitiesCount = useMemo(() => {
        const steps = Array.isArray(json?.steps) ? json.steps : [];
        return steps.filter((step) => {
            const type = step?.type;
            return type === "task" || type === "subprocess" || type === "subProcess";
        }).length;
    }, [json]);

    const gatewaysCount = useMemo(() => {
        const steps = Array.isArray(json?.steps) ? json.steps : [];
        return steps.filter((step) => String(step?.type || "").toLowerCase().includes("gateway")).length;
    }, [json]);

    const allocationRows = useMemo(() => {
        const rows = [];
        const seen = new Set();
        const lines = text.split(/\r?\n/);

        const normalize = (value) => String(value || "")
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s-]/gu, " ")
            .replace(/\s+/g, " ")
            .trim();

        const findSource = (phrase) => {
            const needle = normalize(phrase);
            if (!needle) return "Analyseergebnis";
            const idx = lines.findIndex((line) => normalize(line).includes(needle));
            return idx >= 0 ? `Zeile ${idx + 1} im Textfeld` : "Analyseergebnis";
        };

        const addRow = (wordOrPhrase, bpmnElement) => {
            const term = String(wordOrPhrase || "").trim();
            if (!term) return;
            const key = `${term.toLowerCase()}|${bpmnElement}`;
            if (seen.has(key)) return;
            seen.add(key);
            let rowType = "event";
            if (bpmnElement === "Rolle/Lane") rowType = "role";
            if (bpmnElement === "Aktivität") rowType = "activity";
            if (bpmnElement === "Gateway") rowType = "gateway";
            if (bpmnElement === "Ressource") rowType = "resource";
            rows.push({
                term,
                bpmnElement,
                source: findSource(term),
                rowType
            });
        };

        const roles = Array.isArray(json?.roles) ? json.roles : [];
        roles.forEach((role) => addRow(role, "Rolle/Lane"));

        const steps = Array.isArray(json?.steps) ? json.steps : [];
        const resourceTerms = new Set();
        steps.forEach((step) => {
            const type = String(step?.type || "").toLowerCase();
            const label = step?.label || step?.id;
            if (!label) return;

            if (type.includes("gateway")) {
                addRow(label, "Gateway");
            } else if (type.includes("end") || type.includes("start") || type.includes("event")) {
                addRow(label, "Ereignis");
            } else {
                addRow(label, "Aktivität");
            }

            tokenizeWords(label).forEach((token) => {
                const normalized = normalizeWord(token);
                if (!normalized || normalized.length < 3 || GERMAN_STOPWORDS.has(normalized)) return;
                const isLikelyNoun = token[0] === token[0]?.toUpperCase();
                if (isLikelyNoun) resourceTerms.add(token);
            });
        });

        resourceTerms.forEach((term) => addRow(term, "Ressource"));

        return rows;
    }, [json, text]);

    const highlightedTextHtml = useMemo(() => {
        const safeText = text || "";
        if (!safeText) return "<br />";

        const typeClassByTerm = new Map();
        const rowTypePriority = {
            role: 4,
            gateway: 3,
            resource: 2,
            activity: 1,
            event: 0
        };
        allocationRows.forEach((row) => {
            const normalizedTerm = row.term.toLowerCase();
            const currentType = typeClassByTerm.get(normalizedTerm);
            const nextPriority = rowTypePriority[row.rowType] ?? 0;
            const currentPriority = rowTypePriority[currentType] ?? -1;
            if (!currentType || nextPriority >= currentPriority) {
                typeClassByTerm.set(normalizedTerm, row.rowType);
            }
        });

        const steps = Array.isArray(json?.steps) ? json.steps : [];
        const toTokens = (input) => tokenizeWords(input)
            .map((token) => normalizeWord(token))
            .filter((token) => token.length >= 3)
            .filter((token) => !GERMAN_STOPWORDS.has(token));

        const addTerm = (term, rowType) => {
            const normalized = String(term || "").toLowerCase().trim();
            if (!normalized || normalized.length < 3) return;
            if (!typeClassByTerm.has(normalized)) {
                typeClassByTerm.set(normalized, rowType);
            }
        };

        const addTermWithStemVariants = (term, rowType) => {
            buildVerbVariants(term).forEach((variant) => addTerm(variant, rowType));
        };

        steps.forEach((step) => {
            const type = String(step?.type || "").toLowerCase();
            const label = step?.label || "";
            const tokens = toTokens(label);

            if (type.includes("gateway")) {
                tokens.forEach((token) => addTermWithStemVariants(token, "gateway"));
                addTerm("wenn", "gateway");
                addTerm("falls", "gateway");
                addTerm("sonst", "gateway");
                addTerm("entscheidung", "gateway");
            } else {
                tokens.forEach((token) => addTermWithStemVariants(token, "activity"));
            }
        });

        const terms = Array.from(typeClassByTerm.keys())
            .filter((term) => term.length > 1)
            .sort((a, b) => b.length - a.length);

        if (terms.length === 0) {
            return escapeHtml(safeText).replace(/\n/g, "<br />");
        }

        const regex = new RegExp(terms.map(escapeRegExp).join("|"), "giu");
        const isTokenChar = (char) => /[\p{L}\p{N}-]/u.test(char || "");
        let result = "";
        let lastIndex = 0;
        let match;

        while ((match = regex.exec(safeText)) !== null) {
            const start = match.index;
            const end = start + match[0].length;
            const beforeChar = start > 0 ? safeText[start - 1] : "";
            const afterChar = end < safeText.length ? safeText[end] : "";

            // Guard against false positives: highlight only whole token matches.
            if (isTokenChar(beforeChar) || isTokenChar(afterChar)) {
                continue;
            }

            result += escapeHtml(safeText.slice(lastIndex, start));
            const rowType = typeClassByTerm.get(match[0].toLowerCase()) || "event";
            result += `<span class="hl-${rowType}">${escapeHtml(match[0])}</span>`;
            lastIndex = end;
        }

        result += escapeHtml(safeText.slice(lastIndex));
        return result.replace(/\n/g, "<br />");
    }, [text, allocationRows, json?.steps]);

    const syncEditorScroll = (event) => {
        const top = event.target.scrollTop;
        const left = event.target.scrollLeft;
        if (highlightRef.current) {
            highlightRef.current.scrollTop = top;
            highlightRef.current.scrollLeft = left;
        }
        if (lineNumbersRef.current) {
            lineNumbersRef.current.scrollTop = top;
        }
    };

    const visibleAllocationRows = useMemo(() => {
        const needle = allocationSearch.trim().toLowerCase();
        const filtered = allocationRows.filter((row) => {
            const elementMatch = allocationElementFilter === "all" || row.bpmnElement === allocationElementFilter;
            const searchMatch = !needle
                || row.term.toLowerCase().includes(needle)
                || row.bpmnElement.toLowerCase().includes(needle)
                || row.source.toLowerCase().includes(needle);
            return elementMatch && searchMatch;
        });

        const sourceRank = (source) => {
            const match = String(source).match(/Zeile\s+(\d+)/i);
            return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
        };

        return [...filtered].sort((a, b) => {
            if (allocationSortBy === "term") {
                return a.term.localeCompare(b.term, "de");
            }
            if (allocationSortBy === "element") {
                return a.bpmnElement.localeCompare(b.bpmnElement, "de");
            }
            return sourceRank(a.source) - sourceRank(b.source) || a.term.localeCompare(b.term, "de");
        });
    }, [allocationRows, allocationSearch, allocationElementFilter, allocationSortBy]);

    return (
        <div className="app-shell">
            <img className="app-logo" src={appLogo} alt="ProBPM Draft" />
            <div className="intro-text">
                <p className="intro-title"><strong>Willkommen bei ProBPM.</strong></p>
                <p>
                    Nutzen Sie unseren ProBPM Draft, um aus Prozessbeschreibungen in Sekunden BPMN-Prozessmodelle
                    zu generieren. Gehen Sie dazu wie folgt vor:
                </p>
                <ol>
                    <li>Text eingeben bzw. Dokument hochladen.</li>
                    <li>Klicken Sie auf "Prozessmodell generieren".</li>
                    <li>Passen Sie das Prozessmodell im Editor an, wenn nötig.</li>
                    <li>Exportieren Sie das Prozessmodell mit Klick auf den Download-Button (unterhalb des Editors) im gewünschten Dateiformat.</li>
                </ol>
            </div>
            <p className="status-line">{status}</p>

            <div
                className={`text-editor ${isDragOverEditor ? "drag-over" : ""}`}
                onDragOver={handleEditorDragOver}
                onDragLeave={handleEditorDragLeave}
                onDrop={handleEditorDrop}
            >
                <div className="line-numbers" aria-hidden="true">
                    <div ref={lineNumbersRef} className="line-numbers-inner">
                    {Array.from({ length: textLineCount }, (_, index) => (
                        <div key={`line-${index + 1}`}>{index + 1}</div>
                    ))}
                    </div>
                </div>
                <div className="text-editor-main">
                    {!text ? (
                        <div className="drop-hint" aria-hidden="true">
                            Datei hierher ziehen oder Dokument hochladen
                            <br />
                            <br />
                            Oder beschreiben Sie hier den Prozess textuell.
                        </div>
                    ) : null}
                    <pre
                        ref={highlightRef}
                        className="input-highlight"
                        aria-hidden="true"
                        dangerouslySetInnerHTML={{ __html: highlightedTextHtml }}
                    />
                    <textarea
                        ref={textAreaRef}
                        rows={6}
                        className="input-textarea"
                        placeholder=""
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        onScroll={syncEditorScroll}
                    />
                </div>
            </div>
            <div className="controls-row">
                <button
                    type="button"
                    className="upload-button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isExtractingDocument}
                >
                    {isExtractingDocument ? "Dokument wird gelesen..." : "Dokument hochladen"}
                </button>
                <button className="analyze-button" onClick={handleAnalyze} disabled={isLoading}>
                    {isLoading ? "Analysiere..." : "Prozessmodell generieren"}
                </button>
                <label className="ai-toggle">
                    <input
                        type="checkbox"
                        checked={useAiOptimization}
                        onChange={(e) => setUseAiOptimization(e.target.checked)}
                        disabled={isLoading || isExtractingDocument}
                    />
                    KI-Optimierung
                </label>
                <label className="ai-toggle">
                    <input
                        type="checkbox"
                        checked={showRoutingDebug}
                        onChange={(e) => setShowRoutingDebug(e.target.checked)}
                        disabled={isLoading || isExtractingDocument}
                    />
                    Routing-Debug
                </label>
            </div>
            {useAiOptimization && optimizedInputPreview ? (
                <div className="optimized-preview-note">
                    KI-optimierter Text wurde fuer die Generierung verwendet. Der Originaltext bleibt unveraendert.
                </div>
            ) : null}
            <input
                ref={fileInputRef}
                type="file"
                className="hidden-file-input"
                accept=".pdf,.docx,.txt,.md,.csv,.json"
                onChange={handleUploadDocument}
            />
            {error ? (
                <div className="error-box">
                    {error}
                </div>
            ) : null}
            {warning ? (
                <div className="warning-box">
                    {warning}
                </div>
            ) : null}

            <div className="editor-heading-row">
                <h2 className="editor-heading">BPMN-Editor</h2>
                <button
                    type="button"
                    className="analyze-button editor-relayout-button"
                    onClick={handleRelayout}
                    disabled={isLoading || isExtractingDocument}
                >
                    Layout neu anordnen
                </button>
            </div>
            <div ref={paletteHostRef} className="palette-host" />
            <div ref={containerRef} className="viewer-panel" />

            <div className="post-editor-info">
                {showDownloadOptions ? (
                    <div className="export-inline">
                        <div className="export-row">
                            <button className="download-button" onClick={handleDownloadBpmn} disabled={isExporting}>
                                Download als BPMN-Datei
                            </button>
                        </div>
                        <div className="export-row">
                            <button className="download-button" onClick={handleDownloadPdf} disabled={isExporting}>
                                Download als PDF-Datei
                            </button>
                        </div>
                        <div className="export-row">
                            <button className="download-button" onClick={handleDownloadSvg} disabled={isExporting}>
                                Download als Bild-Datei
                            </button>
                        </div>
                    </div>
                ) : (
                    <div />
                )}

                <div className="analysis-stats editor-stats">
                    <div>Anzahl aller Worte: <strong>{totalWordCount}</strong></div>
                    <div>Davon Anzahl prozessrelevanter Worte: <strong>{processWordCount}</strong></div>
                    <div>Anzahl identifizierter Rollen: <strong>{rolesCount}</strong></div>
                    <div>Anzahl identifizierter Aktivitäten: <strong>{activitiesCount}</strong></div>
                    <div>Anzahl identifizierter Gateways: <strong>{gatewaysCount}</strong></div>
                </div>
                
            </div>

            <div className="allocation-list">
                <h2>Allokationsliste</h2>
                <div className="allocation-controls">
                    <input
                        type="text"
                        className="allocation-input"
                        placeholder="Suche nach Wort, Element oder Quelle..."
                        value={allocationSearch}
                        onChange={(e) => setAllocationSearch(e.target.value)}
                    />
                    <select
                        className="allocation-select"
                        value={allocationElementFilter}
                        onChange={(e) => setAllocationElementFilter(e.target.value)}
                    >
                        <option value="all">Alle Elemente</option>
                        <option value="Rolle/Lane">Rolle/Lane</option>
                        <option value="Aktivität">Aktivität</option>
                        <option value="Gateway">Gateway</option>
                        <option value="Ressource">Ressource</option>
                        <option value="Ereignis">Ereignis</option>
                    </select>
                    <select
                        className="allocation-select"
                        value={allocationSortBy}
                        onChange={(e) => setAllocationSortBy(e.target.value)}
                    >
                        <option value="source">Sortierung: Quelle</option>
                        <option value="term">Sortierung: Wort</option>
                        <option value="element">Sortierung: BPMN-Element</option>
                    </select>
                    <button
                        type="button"
                        className="allocation-reset"
                        onClick={() => {
                            setAllocationSearch("");
                            setAllocationElementFilter("all");
                            setAllocationSortBy("source");
                        }}
                    >
                        Filter zurücksetzen
                    </button>
                </div>
                <table className="allocation-table">
                    <thead>
                        <tr>
                            <th>Prozessrelevantes Wort</th>
                            <th>BPMN-Element</th>
                            <th>Quelle</th>
                        </tr>
                    </thead>
                    <tbody>
                        {visibleAllocationRows.length > 0 ? (
                            visibleAllocationRows.map((row) => (
                                <tr key={`${row.term}-${row.bpmnElement}-${row.source}`} className={`allocation-row-${row.rowType}`}>
                                    <td>{row.term}</td>
                                    <td>{row.bpmnElement}</td>
                                    <td>{row.source}</td>
                                </tr>
                            ))
                        ) : (
                            <tr>
                                <td colSpan={3}>Noch keine Allokationen vorhanden. Bitte zuerst ein Prozessmodell generieren.</td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

export default App;