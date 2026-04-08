import BpmnViewer from "bpmn-js/lib/NavigatedViewer";
import { useState, useEffect, useRef } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "http://localhost:5000";

function App() {
    const [text, setText] = useState("");
    const [xml, setXml] = useState("");
    const [json, setJson] = useState(null);

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
                alert("Fehler: " + (data.error || JSON.stringify(data)));
            }

        } catch (err) {
            console.error(err);
            alert("Backend nicht erreichbar");
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

            <button onClick={handleAnalyze}>
                Prozess analysieren
            </button>

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