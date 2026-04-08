import BpmnModeler from "bpmn-js/lib/Modeler";
import { useState, useEffect, useRef } from "react";
import "./App.css";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";
import { customPaletteModule } from "./bpmn/customPaletteProvider";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

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

    const attachPalette = () => {
        if (!containerRef.current || !paletteHostRef.current) return;
        const paletteEl = containerRef.current.querySelector(".djs-palette");
        if (paletteEl && !paletteHostRef.current.contains(paletteEl)) {
            paletteHostRef.current.appendChild(paletteEl);
        }
    };

    // Initialize editor and palette on load
    useEffect(() => {
        if (!containerRef.current || modelerRef.current) return;

        modelerRef.current = new BpmnModeler({
            container: containerRef.current,
            additionalModules: [customPaletteModule]
        });

        modelerRef.current.createDiagram()
            .then(() => {
                attachPalette();
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