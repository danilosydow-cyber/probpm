export function buildAnalyzePrompt(text, learningGuidance = "") {
    const learningSection = learningGuidance ? `\n${learningGuidance}\n` : "";
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
- BPMN-Best-Practice:
  - BPMN-KERNREGELN (verbindlich):
  - Das Modell startet fachlich mit genau einem Einstiegspfad; technische StartEvents werden spaeter erzeugt
  - Das Modell endet mit mindestens einem End Event
  - Sequenzfluss verbindet Aktivitaeten, Gateways und Enden in klarer Reihenfolge
  - Gateways teilen den Fluss auf oder fuehren ihn zusammen; keine Gateway-Attrappen ohne echte Verzweigung
  - Aktivitaeten sind immer einer Rolle/Lane zugeordnet
  - Datenobjekte/Annotationen nur mit klarer Zuordnung zu einem Schritt
  - Gateways nur bei echter Entscheidung und mit mindestens 2 ausgehenden Bedingungen
  - Exklusives Gateway MUSS genau 2+ ausgehende Bedingungen haben; ein Ein-Zweig-Gateway ist UNGUELTIG
  - Bei binaerer Entscheidung IMMER zwei Zweige modellieren (z. B. "Ja"/"Nein" oder "OK"/"Fehler")
  - Bedingungen an Gateways klar beschriften (bevorzugt "Ja"/"Nein" bei binären Entscheidungen)
  - Gateway-Bedingungen duerfen nicht leer sein und nicht mehrfach auf dasselbe Ziel zeigen
  - Aufeinanderfolgende Aktivitaeten ohne Entscheidung direkt verbinden (kein Pseudo-Gateway)
  - Endereignisse ohne ausgehende Kanten
  - Wenn keine Entscheidung vorliegt, keinen Gateway erzeugen (direkte Task-Folge)
  - Hauptpfad und Nebenpfad klar trennen: Der laengste Entscheidungszweig ist Hauptpfad; Korrektur-/Fehlerzweige sind Nebenpfade
  - Loops explizit modellieren: Rueckfuehrung muss auf den betroffenen Pruefschritt zeigen, nicht auf entfernte Sammelpunkte
  - Nebenpfad-Semantik praezise benennen ("Korrektur", "Nacharbeit", "Fehlerbehandlung"), damit Routing robust unterscheidbar ist
  - Keine konkurrierenden direkten Kanten zum Abschluss, wenn ein Korrektur-Loop vorgesehen ist
  - Abfolge-Logik strikt einhalten: jeder Schritt braucht einen klaren Vorgaenger/Nachfolger; keine isolierten oder widerspruechlichen Kanten
  - BPMN-Syntax strikt einhalten: type "gateway" nur mit "conditions", type "task" nur mit "next", type "end" ohne ausgehende Kanten
- Falls der Eingangstext bereits BPMN-orientiert strukturiert ist (z. B. mit Rollen-, Status-, Abhaengigkeits- oder Zeitachsen-Hinweisen),
  dann diese Informationen direkt auswerten und in Steps, Rollen, Gateway-Bedingungen und Kanten ueberfuehren.
- Statuswerte wie "offen", "in Bearbeitung", "geprueft", "freigegeben", "abgeschlossen" als fachliche Hinweise behandeln,
  nicht als separate Prozessinstanzen.
${learningSection}

TEXT:
${text}
`;
}

export function buildRepairPrompt({
    sourceText,
    previousJson,
    validationErrors = [],
    learningGuidance = ""
}) {
    const errorLines = (Array.isArray(validationErrors) ? validationErrors : [])
        .map((item, index) => `- Fehler ${index + 1}: ${String(item || "").trim()}`)
        .filter(Boolean)
        .join("\n");
    const learningSection = learningGuidance ? `\n${learningGuidance}\n` : "";

    return `
Du bist ein BPMN-JSON-Reparaturassistent.

Repariere das gegebene JSON so, dass es alle BPMN-Regeln einhaelt und gueltig ist.

REGELN:
- Gib NUR gueltiges JSON zurueck (kein Markdown, kein Erklaertext)
- Halte die fachliche Bedeutung des Quelltexts stabil
- Behebe NUR strukturelle/semantische Modellierungsfehler
- Keine doppelten IDs, keine null-Werte, keine losen Kanten

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
      ]
    }
  ]
}

WICHTIG:
- Der erste Schritt ist type "task"
- Mindestens 1 End Event (type "end")
- Gateways nur bei echter Entscheidung und immer mit 2+ Bedingungen
- "conditions" nur bei gateways, "next" nur bei tasks
- End Events ohne ausgehende Kanten
- Jede Rolle pro Step muss in "roles" vorkommen
- Jede target-Referenz muss auf existierende Step-ID zeigen
- Hauptpfad klar, Nebenpfade eindeutig beschriftet (z. B. Nein/Fehler/Korrektur)
- Exakt ein fachlicher Einstiegs-Step (nur ein Schritt ohne eingehende Kante)
${learningSection}

ZU BEHEBENDE VALIDIERUNGSFEHLER:
${errorLines || "- (keine Einzelpunkte uebergeben; trotzdem JSON robust reparieren)"}

QUELLTEXT:
${sourceText}

FEHLERHAFTES JSON:
${JSON.stringify(previousJson, null, 2)}
`;
}

export function buildOptimizationGuidanceFromKnowledgeBase(knowledgeBase) {
    const instructions = Array.isArray(knowledgeBase?.instructions) ? knowledgeBase.instructions : [];
    const antiPatterns = Array.isArray(knowledgeBase?.antiPatterns) ? knowledgeBase.antiPatterns : [];
    const checklist = Array.isArray(knowledgeBase?.qualityChecklist) ? knowledgeBase.qualityChecklist : [];

    const priorityWeight = (entry) => {
        const raw = String(entry?.priority || "").trim().toLowerCase();
        if (raw === "must") return 300;
        if (raw === "should") return 200;
        if (raw === "could") return 100;

        const level = String(entry?.level || "").trim().toLowerCase();
        if (level === "advanced") return 180;
        if (level === "basic") return 150;
        return 120;
    };
    const priorityLabel = (entry) => {
        const raw = String(entry?.priority || "").trim().toLowerCase();
        if (raw === "must" || raw === "should" || raw === "could") return raw.toUpperCase();
        return "SHOULD";
    };

    const topInstructions = [...instructions]
        .sort((a, b) => priorityWeight(b) - priorityWeight(a))
        .slice(0, 10)
        .map((entry) =>
            `- [${priorityLabel(entry)}] [${entry.category}] ${entry.title}: ${entry.guideline}`
        );
    const topAntiPatterns = antiPatterns.slice(0, 4).map((entry) =>
        `- ${entry.name}: ${entry.fix}`
    );
    const topChecklist = checklist.slice(0, 6).map((item) => `- ${item}`);

    const blocks = [];
    if (topInstructions.length > 0) {
        blocks.push(`BPMN-REGELN:\n${topInstructions.join("\n")}`);
    }
    if (topAntiPatterns.length > 0) {
        blocks.push(`ZU VERMEIDENDE MUSTER:\n${topAntiPatterns.join("\n")}`);
    }
    if (topChecklist.length > 0) {
        blocks.push(`QUALITAETSCHECK:\n${topChecklist.join("\n")}`);
    }

    return blocks.join("\n\n").trim();
}

export function buildOptimizationPrompt(text, guidance = "") {
    const guidanceSection = guidance
        ? `\nNUTZE DIESE BPMN-WISSENSBASIS BEI DER OPTIMIERUNG:\n${guidance}\n`
        : "";
    return `
Du bist ein BPMN-Text-Optimierer.

Verbessere den folgenden Prozess-Text so, dass ein BPMN-Parser Rollen, Aktivitaeten, Gateways und Ablaufkanten leichter erkennt.

REGELN:
- Gib NUR optimierten Klartext im BPMN-Schema zurueck (kein Markdown, keine JSON-Ausgabe)
- Keine Erklaerungen, keine Vorbemerkung
- Bedeutung des Originaltexts erhalten
- Rollen explizit nennen (statt unklarer Pronomen)
- Entscheidungen als klare Frage formulieren (z. B. "Zahlung erfolgreich?")
- Ergebnis auf kurze, eindeutige Saetze normalisieren
- Keine neuen fachlichen Schritte erfinden
- Bei Entscheidungen immer beide Zweige benennen (Ja/Nein oder Erfolg/Fehler)
- Korrektur/Nacharbeit immer als Nebenpfad mit Ruecksprung auf den fachlich naechsten Pruefschritt formulieren
- Abschluss/Ende nur im Hauptpfad formulieren, wenn Korrekturzweig erfolgreich beendet ist
- Aktivitaeten in zeitlicher Reihenfolge als "Schritt 1", "Schritt 2", ... formulieren
- Fuer jeden Schritt Rolle, Aktivitaet, optionalen Status und relevante Abhaengigkeit benennen
- Abhaengigkeiten explizit formulieren ("nach", "erst wenn", "parallel zu vermeiden")
- BPMN-orientierte Sprache verwenden: Aktivitaet, Entscheidung, Ja-Pfad, Nein-/Fehlerpfad, Ruecksprung, Ende

AUSGABESCHEMA (als Klartextzeilen, ohne Bullets):
Rollen: <kommagetrennte Rollen>
Schritt 1: Rolle=<Rolle>; Aktivitaet=<Verb+Objekt>; Status=<offen|in Bearbeitung|abgeschlossen>; Abhaengigkeit=<Start|nach Schritt X>
Schritt 2: ...
Entscheidung 1: Frage=<klare Ja/Nein Frage>; Ja-><Schritt X>; Nein-><Schritt Y>
Zeitachse: Schritt 1 -> Schritt 2 -> ... -> Ende; Ruecksprung(e)=<von->nach>
${guidanceSection}

TEXT:
${text}
`;
}
