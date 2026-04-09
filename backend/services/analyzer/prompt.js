export function buildAnalyzePrompt(text) {
    return `
Du bist ein BPMN-Experte.

Analysiere den folgenden Prozess-Text und wandle ihn in ein strukturiertes JSON um.

REGELN:
- Gib NUR gueltiges JSON zurueck (kein Markdown, kein Text)
- KEINE Erklaerungen
- KEINE Codebloecke

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
- StartEvents werden spaeter technisch erzeugt
- Mindestens 1 End Event(type: end)
- Gateways verwenden bei Entscheidungen
- Jeder Step hat genau eine Rolle
- Rollen explizit und durchgaengig benennen (z. B. Mitarbeiter, Teamleiter, System)
- Step.role muss exakt einer Rolle aus "roles" entsprechen
- IDs streng fortlaufend (step_1, step_2, ...)
- Keine losen Verbindungen
- Jeder Step muss erreichbar sein
- Labels fuer Rollen und Steps maximal 3 Woerter
- "conditions" NUR bei gateways
- "next" NUR bei tasks
- KEINE doppelten IDs
- KEINE null Werte
- Dieselbe realweltliche Aktivitaet nur EINMAL als Step: bei Wiederholung (z. B. erneut pruefen)
  denselben bestehenden Task per Kante ansprechen, keinen zweiten gleichlautenden Task anlegen

TEXT:
${text}
`;
}
