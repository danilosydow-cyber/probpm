import OpenAI from "openai";

const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

export async function analyzeTextToProcess(text) {

    if (!text || text.length < 5) {
        throw new Error("Text zu kurz für Analyse");
    }

    // =========================
    // 🔥 NEUER SAUBERER PROMPT
    // =========================
    const prompt = `
Du bist ein BPMN-Experte.

Analysiere den folgenden Prozess-Text und wandle ihn in ein strukturiertes JSON um.

REGELN:
- Gib NUR gültiges JSON zurück (kein Markdown, kein Text)
- KEINE Erklärungen
- KEINE Codeblöcke

FORMAT:

{
  "roles": ["Rolle1", "Rolle2"],
  "steps": [
    {
      "id": "step_1",
      "type": "task | gateway | end",
      "label": "Kurzbeschreibung",
      "role": "Rolle",
      "next": ["step_2"],
      "conditions": [
        { "label": "Ja", "target": "step_3" },
        { "label": "Nein", "target": "step_4" }
      ]
    }
  ]
}

WICHTIG:
- KEIN Start Event erzeugen
- Der erste Schritt ist IMMER ein "task"
- StartEvents werden später technisch erzeugt
- Mindestens 1 End Event(type: end)

- Gateways verwenden bei:
  - wenn
  - falls
  - sonst
  - Entscheidungen

- Jeder Step hat genau eine Rolle
- IDs streng fortlaufend (step_1, step_2, ...)
- KEINE losen Verbindungen
- Jeder Step muss erreichbar sein

- "conditions" NUR bei gateways
- "next" NUR bei tasks

ANTI-FEHLER:
- KEINE doppelten IDs
- KEINE leeren Arrays
- KEINE null Werte
- KEINE Kommentare

TEXT:
${text}
`;

    try {
        const response = await client.chat.completions.create({
            model: "gpt-4.1",
            temperature: 0,
            messages: [
                {
                    role: "system",
                    content: "Du bist ein extrem präziser BPMN-Prozess-Parser."
                },
                {
                    role: "user",
                    content: prompt
                }
            ]
        });

        let content = response?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || content.trim().length === 0) {
            throw new Error("Leere oder ungültige KI-Antwort erhalten");
        }

        // =========================
        // 🔧 CLEANUP
        // =========================
        content = content
            .replace(/```json/g, "")
            .replace(/```/g, "")
            .trim();

        const start = content.indexOf("{");
        const end = content.lastIndexOf("}");

        if (start !== -1 && end !== -1) {
            content = content.substring(start, end + 1);
        }

        // =========================
        // 🧠 JSON PARSEN
        // =========================
        const json = JSON.parse(content);

        // =========================
        // 🔥 VALIDIERUNG
        // =========================

        if (!json.roles || !Array.isArray(json.roles) || json.roles.length === 0) {
            throw new Error("Keine Rollen erkannt");
        }

        if (!json.steps || json.steps.length === 0) {
            throw new Error("Keine Steps erkannt");
        }

        // ❗ KEIN StartEvent mehr prüfen!

        const endEvents = json.steps.filter(s => s.type === "end");

        if (endEvents.length < 1) {
            throw new Error("Mindestens 1 End Event erforderlich");
        }

        // IDs prüfen
        const ids = new Set();
        for (const step of json.steps) {
            if (ids.has(step.id)) {
                throw new Error("Doppelte Step-ID: " + step.id);
            }
            ids.add(step.id);
        }

        // =========================
        // 🔥 SICHERHEITS-FIX (WICHTIG)
        // =========================
        // Falls GPT trotzdem StartEvents erzeugt → entfernen
        json.steps.forEach(step => {
            if (step.type === "start" || step.type === "startEvent") {
                step.type = "task";
            }
        });

        console.log("✅ Analyzer Output:", json);

        return json;

    } catch (err) {
        console.error("❌ Analyzer Fehler:", err.message);
        throw new Error("Fehler bei KI-Analyse: " + err.message);
    }
}