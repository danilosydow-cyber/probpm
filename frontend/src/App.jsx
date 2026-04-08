import BpmnModeler from "bpmn-js/lib/Modeler";
import { useState, useEffect, useRef } from "react";
import "./App.css";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";
import { customPaletteModule } from "./bpmn/customPaletteProvider";
import { customTranslateModule } from "./bpmn/customTranslateModule";

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

const ROLE_TYPES = new Set(["bpmn:Participant", "bpmn:Lane"]);
const RESOURCE_TYPES = new Set(["bpmn:DataObjectReference", "bpmn:DataStoreReference", "bpmn:DataStore"]);

const isBpmnType = (element, bpmnType) => element?.businessObject?.$instanceOf?.(bpmnType);

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
    const [status, setStatus] = useState("Bereit");
    const [isLoading, setIsLoading] = useState(false);

    const containerRef = useRef(null);
    const paletteHostRef = useRef(null);
    const modelerRef = useRef(null);
    const activePaletteEntryRef = useRef(null);

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

    const applyElementColors = () => {
        if (!modelerRef.current) return;
        const elementRegistry = modelerRef.current.get("elementRegistry");

        elementRegistry.forEach((element) => {
            applyElementColor(element);
        });
    };

    // Initialize editor and palette on load
    useEffect(() => {
        if (!containerRef.current || modelerRef.current) return;

        modelerRef.current = new BpmnModeler({
            container: containerRef.current,
            additionalModules: [customPaletteModule, customTranslateModule]
        });

        const scheduleApplyColor = (element) => {
            if (!element) return;
            setTimeout(() => applyElementColor(element), 0);
        };

        const eventBus = modelerRef.current.get("eventBus");
        eventBus.on("shape.added", ({ element }) => {
            scheduleApplyColor(element);
            clearActivePaletteEntry();
        });
        eventBus.on("commandStack.shape.create.postExecuted", ({ context }) => {
            scheduleApplyColor(context?.shape);
        });
        eventBus.on("commandStack.shape.append.postExecuted", ({ context }) => {
            scheduleApplyColor(context?.shape);
        });
        eventBus.on("commandStack.elements.create.postExecuted", ({ context }) => {
            (context?.elements || []).forEach(scheduleApplyColor);
        });
        eventBus.on("commandStack.shape.replace.postExecuted", ({ context }) => {
            scheduleApplyColor(context?.newShape);
        });

        modelerRef.current.createDiagram()
            .then(() => {
                attachPalette();
                setupPaletteInteraction();
                applyElementColors();
                modelerRef.current.get("canvas").zoom("fit-viewport");
            })
            .catch((err) => {
                console.error("BPMN Init Fehler:", err);
            });
    }, []);

    // Import generated XML once available
    useEffect(() => {
        if (!xml || !modelerRef.current) return;
        modelerRef.current.importXML(xml)
            .then(() => {
                attachPalette();
                setupPaletteInteraction();
                applyElementColors();
                modelerRef.current.get("canvas").zoom("fit-viewport");
            })
            .catch(err => {
                console.error("BPMN Fehler:", err);
            });
    }, [xml]);

    useEffect(() => {
        return () => {
            if (modelerRef.current) {
                modelerRef.current.destroy();
                modelerRef.current = null;
            }
        };
    }, []);

    const handleAnalyze = async () => {
        const trimmedText = text.trim();
        if (trimmedText.length < 5) {
            setError("Bitte gib mindestens 5 Zeichen ein.");
            return;
        }

        setError("");
        setStatus("Analysiere Prozess...");
        setIsLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/generate`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ text: trimmedText })
            });

            const data = await res.json();

            if (res.ok && data.success) {
                setJson(data.json);
                setXml(data.xml);
                setStatus("Analyse erfolgreich.");
            } else {
                setError(data.error || "Unbekannter Fehler bei der Analyse.");
                setStatus("Analyse fehlgeschlagen.");
            }

        } catch (err) {
            console.error(err);
            setError(`Backend nicht erreichbar unter ${API_BASE_URL}.`);
            setStatus("Backend nicht erreichbar.");
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="app-shell">
            <h1>ProBPM</h1>
            <p className="status-line">{status}</p>

            <textarea
                rows={6}
                className="input-textarea"
                placeholder="Beschreibe deinen Prozess..."
                value={text}
                onChange={(e) => setText(e.target.value)}
            />
            <div className="controls-row">
            <button className="analyze-button" onClick={handleAnalyze} disabled={isLoading}>
                {isLoading ? "Analysiere..." : "Prozess analysieren"}
            </button>
            </div>
            {error ? (
                <div className="error-box">
                    {error}
                </div>
            ) : null}

            <h2>BPMN-Editor</h2>
            <div ref={paletteHostRef} className="palette-host" />
            <div ref={containerRef} className="viewer-panel" />

            <h2>JSON</h2>
            <pre className="json-panel">
                {JSON.stringify(json, null, 2)}
            </pre>
        </div>
    );
}

export default App;