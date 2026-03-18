import React, { useState } from "react";
import { analyzeProcess } from "../api/api";

function Upload({ setBpmnXml }) {
    const [inputText, setInputText] = useState("");

    // 🚀 Button Handler
    const handleAnalyze = async () => {
        try {
            console.log("BUTTON GEKLICKT");

            const result = await analyzeProcess(inputText);

            console.log("🔥 BACKEND RESPONSE:", result);

            // 👉 wichtig für dein Diagramm
            if (result.bpmn) {
                setBpmnXml(result.bpmn);
            }

        } catch (error) {
            console.error("❌ Fehler:", error);
        }
    };

    return (
        <div style={{ padding: "20px" }}>
            <h2>Prozess eingeben</h2>

            <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="z.B. Ein Antrag wird geprüft..."
                rows={6}
                style={{ width: "100%", marginBottom: "10px" }}
            />

            <button onClick={handleAnalyze}>
                Prozess analysieren
            </button>
        </div>
    );
}

export default Upload;