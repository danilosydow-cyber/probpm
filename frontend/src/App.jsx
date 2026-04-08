import BpmnViewer from "bpmn-js/lib/NavigatedViewer";
import { useState, useEffect, useRef } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

function App() {
    const [text, setText] = useState("");
    const [xml, setXml] = useState("");
    const [json, setJson] = useState(null);
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const containerRef = useRef(null);
    const viewerRef = useRef(null);

   

    // Viewer
    useEffect(() => {
        if (!xml || !containerRef.current) return;

        if (!viewerRef.current) {
            viewerRef.current = new BpmnViewer({
                container: containerRef.current
            });
        }

        viewerRef.current.importXML(xml)
            .then(() => {
                viewerRef.current.get("canvas").zoom("fit-viewport");
            })
            .catch(err => {
                console.error("BPMN Fehler:", err);
            });

    }, [xml]);

    useEffect(() => {
        return () => {
            if (viewerRef.current) {
                viewerRef.current.destroy();
                viewerRef.current = null;
            }
        };
    }, []);

    const handleAnalyze = async () => {
        setError("");
        setIsLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/generate`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ text })
            });

            const data = await res.json();

            if (res.ok && data.success) {
                setJson(data.json);
                setXml(data.xml);
            } else {
                setError(data.error || "Unbekannter Fehler bei der Analyse.");
            }

        } catch (err) {
            console.error(err);
            setError(`Backend nicht erreichbar unter ${API_BASE_URL}.`);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={{ padding: 20 }}>
            <h1>ProBPM</h1>

            <textarea
                rows={6}
                style={{ width: "100%" }}
                placeholder="Beschreibe deinen Prozess..."
                value={text}
                onChange={(e) => setText(e.target.value)}
            />

            <br /><br />

            <button onClick={handleAnalyze} disabled={isLoading}>
                {isLoading ? "Analysiere..." : "Prozess analysieren"}
            </button>
            {error ? (
                <div
                    style={{
                        marginTop: "12px",
                        padding: "10px",
                        border: "1px solid #ffb3b3",
                        background: "#fff5f5",
                        color: "#a40000"
                    }}
                >
                    {error}
                </div>
            ) : null}

            <h2>JSON</h2>
            <pre style={{ background: "#eee", padding: 10 }}>
                {JSON.stringify(json, null, 2)}
            </pre>

            <h2>BPMN Viewer</h2>
            <div
                ref={containerRef}
                style={{
                    height: "500px",
                    border: "1px solid #ccc",
                    marginTop: "20px"
                }}
            />
        </div>
    );
}

export default App;