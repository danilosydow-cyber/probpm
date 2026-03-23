import React, { useState } from "react";
import { analyzeProcess } from "../api/api";

function Upload({ setBpmnXml }) {

    const [inputText, setInputText] = useState("");

    const handleAnalyze = async () => {
        try {

            console.log("Sende Text an Backend...");

            const result = await analyzeProcess(inputText);

            console.log("BACKEND RESPONSE:", result);

            // 🔥 FIX: xml statt bpmn
            if (result.xml) {
                setBpmnXml(result.xml);
            }

        } catch (error) {
            console.error("Fehler:", error);
        }
    };

    return (
        <div style={{ padding: "20px" }}>

            <h2>Prozess eingeben</h2>

            <textarea
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
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