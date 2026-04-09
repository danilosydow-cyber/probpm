export function buildAnalyzePrompt(text) {
    return `
Du bist ein BPMN-Experte.

Analysiere den folgenden Prozess-Text und wandle ihn in ein strukturiertes JSON um.

REGELN:
- Gib NUR gueltiges JSON zurueck (kein Markdown, kein Text)
- KEINE Erklaerungen
- KEINE Codebloecke

FORMAT (Root-Objekt):

{
  "roles": ["Rolle1", "Rolle2"],
  "annotations": [
    { "id": "ann_1", "text": "Kurzer Hinweistext", "attachTo": "step_3" }
  ],
  "steps": [
    {
      "id": "step_1",
      "type": "task | gateway | end",
      "taskKind": "userTask | serviceTask | manualTask | scriptTask | sendTask | receiveTask | businessRuleTask | task",
      "label": "Kurzbeschreibung",
      "role": "Rolle",
      "documentation": "Optionale ausfuehrliche Beschreibung",
      "next": ["step_2"],
      "conditions": [
        { "label": "Ja", "target": "step_3" },
        { "label": "Nein", "target": "step_4" }
      ],
      "boundaryTimers": [
        {
          "label": "Timer Kurzname",
          "target": "step_ziel_nach_timer",
          "interrupting": true,
          "duration": "optional z.B. PT24H oder Freitext"
        }
      ],
      "email": {
        "to": "empfaenger@firma.de",
        "cc": "",
        "bcc": "",
        "from": "absender@firma.de",
        "subject": "Betreff",
        "template": "vorlagen_name",
        "body": "Kurztext",
        "noBcsStyling": false
      }
    }
  ]
}

FELDER:
- "annotations" optional. Verbinde Hinweise mit einem Step per attachTo (Step-ID). Keine lose Texte ohne Bezug.
- "taskKind" NUR bei type "task": waehle passend zum Text:
  - userTask: menschliche Bearbeitung, Genehmigung, Pruefung durch Person
  - serviceTask: automatisiert, System, E-Mail versenden, Status setzen, Schnittstelle
  - manualTask: manuell ohne IT, physisch
  - scriptTask: Skript/Ausfuehrung
  - sendTask/receiveTask: Nachricht senden/empfangen
  - businessRuleTask: Regelwerk/Entscheidungstabelle
  - task: neutral wenn unklar
- "email" optional, sinnvoll bei serviceTask mit E-Mail-Versand (BCS/Designer-Aehnlichkeit): to, cc, bcc, from, subject, template, body, noBcsStyling
- "boundaryTimers" optional: an einem Task haengender Zeit-Trigger; "target" ist der Step, der nach dem Timer folgt; interrupting false = nicht unterbrechend
- "documentation" optional: laengere Beschreibung zum Step

WICHTIG:
- KEIN Start Event in steps erzeugen
- Der erste Schritt ist IMMER type "task" (mit passendem taskKind)
- StartEvents werden technisch ergaenzt
- Mindestens 1 End Event (type: end)
- Gateways bei echten Entscheidungen
- Jeder Step hat genau eine Rolle (boundaryTimer-Host = Rolle des Tasks)
- Step.role muss in "roles" vorkommen
- IDs fortlaufend step_1, step_2, ...
- Keine losen Verbindungen, jeder Step erreichbar
- Labels fuer Rollen und Steps maximal 3 Woerter (Ausnahme: annotations.text bis ca. 20 Woerter)
- "conditions" NUR bei gateways
- "next" NUR bei tasks (nicht bei gateway/end)
- KEINE doppelten IDs, KEINE null Werte
- Dieselbe realweltliche Aktivitaet nur EINMAL als Step; bei Wiederholung bestehenden Task per Kante nutzen

TEXT:
${text}
`;
}
