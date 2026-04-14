import test from "node:test";
import assert from "node:assert/strict";

import { parseAnalyzerResponse } from "../services/analyzer/parseResponse.js";
import { validateProcessShape } from "../services/analyzer/validateProcess.js";
import { normalizeProcessJson } from "../services/analyzer/normalizeProcess.js";
import {
    buildAnalyzePrompt,
    buildOptimizationGuidanceFromKnowledgeBase,
    buildOptimizationPrompt
} from "../services/analyzer/prompt.js";
import { buildSemanticIRFromProcess, prevalidateSemanticProcess } from "../services/analyzer/index.js";
import { buildBpmnQualityScorecard } from "../services/bpmnQualityScorecard.js";
import { analyzeBpmnDiagram } from "../services/bpmnDiagramMetrics.js";

test("parseAnalyzerResponse extracts JSON from markdown block", () => {
    const parsed = parseAnalyzerResponse("```json\n{\"roles\":[\"System\"],\"steps\":[{\"id\":\"step_1\",\"type\":\"end\",\"role\":\"System\"}]}\n```");
    assert.deepEqual(parsed, {
        roles: ["System"],
        steps: [{ id: "step_1", type: "end", role: "System" }]
    });
});

test("validateProcessShape rejects duplicate step ids", () => {
    assert.throws(
        () => validateProcessShape({
            roles: ["System"],
            steps: [
                { id: "step_1", type: "task", role: "System" },
                { id: "step_1", type: "end", role: "System" }
            ]
        }),
        /Doppelte Step-ID/
    );
});

test("normalizeProcessJson compacts labels and normalizes start types", () => {
    const normalized = normalizeProcessJson({
        roles: ["Mitarbeiter Support Team"],
        steps: [
            {
                id: "step_1",
                type: "startEvent",
                label: "Anfrage sehr detailliert aufnehmen",
                role: "Mitarbeiter Support Team"
            },
            {
                id: "step_2",
                type: "end",
                label: "Prozess abschliessen",
                role: "Mitarbeiter Support Team"
            }
        ]
    });

    assert.equal(normalized.steps[0].type, "task");
    assert.equal(normalized.roles[0], "Mitarbeiter Support Team");
    assert.equal(normalized.steps[0].label, "Anfrage sehr detailliert");
});

test("normalizeProcessJson removes duplicate or noisy connections", () => {
    const normalized = normalizeProcessJson({
        roles: ["Mitarbeiter", "System"],
        steps: [
            {
                id: "step_1",
                type: "task",
                label: "Starten",
                role: "Mitarbeiter",
                next: ["step_2", "step_2", "step_3", "step_1", "step_999"]
            },
            {
                id: "step_2",
                type: "gateway",
                label: "Pruefen?",
                role: "System",
                next: ["step_3"],
                conditions: [
                    { label: "Ja", target: "step_3" },
                    { label: "yes", target: "step_3" },
                    { label: "Nein", target: "step_4" },
                    { label: "Fehler", target: "step_2" },
                    { label: "Ungueltig", target: "step_999" }
                ]
            },
            { id: "step_3", type: "task", label: "Weiter", role: "System", next: ["step_4"] },
            { id: "step_4", type: "end", label: "Ende", role: "System" }
        ]
    });

    const step1 = normalized.steps.find((s) => s.id === "step_1");
    const step2 = normalized.steps.find((s) => s.id === "step_2");

    assert.deepEqual(step1.next, ["step_2"], "Task should keep only one primary outgoing dependency");
    assert.ok(Array.isArray(step1.conditions) && step1.conditions.length === 0, "Task should not keep conditions");
    assert.ok(Array.isArray(step2.next) && step2.next.length === 0, "Gateway should not keep next array");
    assert.deepEqual(
        step2.conditions.map((c) => c.target),
        ["step_3"],
        "Gateway should keep unique valid non-transitive condition targets only"
    );
});

test("normalizeProcessJson removes transitive direct edges", () => {
    const normalized = normalizeProcessJson({
        roles: ["System"],
        steps: [
            {
                id: "step_1",
                type: "gateway",
                label: "Route",
                role: "System",
                conditions: [
                    { label: "Pfad A", target: "step_2" },
                    { label: "Direkt", target: "step_3" }
                ]
            },
            { id: "step_2", type: "task", label: "Zwischenstufe", role: "System", next: ["step_3"] },
            { id: "step_3", type: "end", label: "Ende", role: "System" }
        ]
    });

    const step1 = normalized.steps.find((s) => s.id === "step_1");
    assert.deepEqual(
        step1.conditions.map((c) => c.target),
        ["step_2"],
        "Transitive direct edge step_1->step_3 should be removed"
    );
});

test("normalizeProcessJson merges duplicate tasks with same role and label", () => {
    const normalized = normalizeProcessJson({
        roles: ["System"],
        steps: [
            { id: "step_a", type: "task", label: "Pflichtfelder pruefen", role: "System", next: ["step_g"] },
            {
                id: "step_g",
                type: "gateway",
                label: "OK?",
                role: "System",
                conditions: [
                    { label: "Nein", target: "step_fix" },
                    { label: "Ja", target: "step_end" }
                ]
            },
            { id: "step_fix", type: "task", label: "Korrigieren", role: "System", next: ["step_b"] },
            { id: "step_b", type: "task", label: "Pflichtfelder pruefen", role: "System", next: ["step_g"] },
            { id: "step_end", type: "end", label: "Ende", role: "System" }
        ]
    });

    const ids = new Set(normalized.steps.map((s) => s.id));
    assert.ok(ids.has("step_a") && !ids.has("step_b"), "Second identical task should be merged into first");
    const fix = normalized.steps.find((s) => s.id === "step_fix");
    assert.deepEqual(fix.next, ["step_a"], "Correction should loop back to canonical check task");
});

test("validateProcessShape rejects invalid taskKind", () => {
    assert.throws(
        () =>
            validateProcessShape({
                roles: ["System"],
                steps: [
                    { id: "step_1", type: "task", taskKind: "robotTask", role: "System", next: ["step_2"] },
                    { id: "step_2", type: "end", role: "System" }
                ]
            }),
        /Unbekannter taskKind/
    );
});

test("normalizeProcessJson keeps distinct tasks when taskKind differs", () => {
    const normalized = normalizeProcessJson({
        roles: ["System"],
        steps: [
            { id: "step_1", type: "task", taskKind: "userTask", label: "Genehmigen", role: "System", next: ["step_3"] },
            { id: "step_2", type: "task", taskKind: "serviceTask", label: "Genehmigen", role: "System", next: ["step_3"] },
            { id: "step_3", type: "end", label: "Ende", role: "System" }
        ]
    });

    assert.ok(normalized.steps.some((s) => s.id === "step_1"));
    assert.ok(normalized.steps.some((s) => s.id === "step_2"));
});

test("normalizeProcessJson filters annotations to valid attachTo", () => {
    const normalized = normalizeProcessJson({
        roles: ["System"],
        steps: [
            { id: "step_1", type: "task", label: "A", role: "System", next: ["step_2"] },
            { id: "step_2", type: "end", label: "E", role: "System" }
        ],
        annotations: [
            { id: "ann_ok", text: "Hinweis zum Schritt", attachTo: "step_1" },
            { id: "ann_bad", text: "Unbekannt", attachTo: "step_999" }
        ]
    });

    assert.equal(normalized.annotations.length, 1);
    assert.equal(normalized.annotations[0].attachTo, "step_1");
});

test("normalizeProcessJson keeps single-branch gateway without next edges", () => {
    const normalized = normalizeProcessJson({
        roles: ["System"],
        steps: [
            { id: "step_1", type: "gateway", label: "Pruefen", role: "System", conditions: [{ label: "ok", target: "step_2" }] },
            { id: "step_2", type: "end", label: "Ende", role: "System" }
        ]
    });

    const step1 = normalized.steps.find((s) => s.id === "step_1");
    assert.equal(step1.type, "gateway");
    assert.deepEqual(step1.next, []);
    assert.deepEqual(step1.conditions.map((c) => c.target), ["step_2"]);
});

test("normalizeProcessJson enforces two-way labels for unlabeled gateway branches", () => {
    const normalized = normalizeProcessJson({
        roles: ["System"],
        steps: [
            {
                id: "step_1",
                type: "gateway",
                label: "Entscheidung",
                role: "System",
                conditions: [
                    { label: "Pfad A", target: "step_2" },
                    { label: "Pfad B", target: "step_3" }
                ]
            },
            { id: "step_2", type: "end", label: "Ende", role: "System" },
            { id: "step_3", type: "end", label: "Ende", role: "System" }
        ]
    });

    const step1 = normalized.steps.find((s) => s.id === "step_1");
    assert.deepEqual(step1.conditions.map((c) => c.label), ["Ja", "Nein"]);
});

test("normalizeProcessJson adds implicit end for dead-end task", () => {
    const normalized = normalizeProcessJson({
        roles: ["System"],
        steps: [
            { id: "step_1", type: "task", label: "Bearbeiten", role: "System" }
        ]
    });

    const step1 = normalized.steps.find((s) => s.id === "step_1");
    assert.equal(step1.next.length, 1);
    const implicitEnd = normalized.steps.find((s) => s.id === step1.next[0]);
    assert.ok(implicitEnd);
    assert.equal(implicitEnd.type, "end");
});

test("normalizeProcessJson fixes correction branch polarity and enforces local loop", () => {
    const normalized = normalizeProcessJson({
        roles: ["Sachbearbeiter"],
        steps: [
            { id: "step_1", type: "task", label: "Fall erfassen", role: "Sachbearbeiter", next: ["step_2"] },
            { id: "step_2", type: "task", label: "Fall prüfen", role: "Sachbearbeiter", next: ["step_3"] },
            {
                id: "step_3",
                type: "gateway",
                label: "Fall korrekt?",
                role: "Sachbearbeiter",
                conditions: [
                    { label: "Ja", target: "step_4" },
                    { label: "Nein", target: "step_5" }
                ]
            },
            { id: "step_4", type: "task", label: "Korrektur durchführen", role: "Sachbearbeiter", next: ["step_6"] },
            { id: "step_5", type: "task", label: "Ergebnis kommunizieren", role: "Sachbearbeiter", next: ["step_6"] },
            { id: "step_6", type: "end", label: "Ende", role: "Sachbearbeiter" }
        ]
    });

    const gateway = normalized.steps.find((step) => step.id === "step_3");
    const noBranch = gateway.conditions.find((cond) => String(cond.label).toLowerCase() === "nein");
    const yesBranch = gateway.conditions.find((cond) => String(cond.label).toLowerCase() === "ja");
    const correctionStep = normalized.steps.find((step) => step.id === noBranch.target);

    assert.equal(String(correctionStep.label).toLowerCase().includes("korrektur"), true);
    assert.equal(Array.isArray(correctionStep.next), true);
    assert.deepEqual(correctionStep.next, ["step_2"]);
    assert.equal(yesBranch.target, "step_5");
});

test("normalizeProcessJson keeps negated approval labels on no-branch", () => {
    const normalized = normalizeProcessJson({
        roles: ["System"],
        steps: [
            { id: "step_1", type: "task", label: "Pruefen", role: "System", next: ["step_2"] },
            {
                id: "step_2",
                type: "gateway",
                label: "Freigabe?",
                role: "System",
                conditions: [
                    { label: "nicht genehmigt", target: "step_3" },
                    { label: "genehmigt", target: "step_4" }
                ]
            },
            { id: "step_3", type: "task", label: "Korrektur", role: "System", next: ["step_1"] },
            { id: "step_4", type: "end", label: "Ende", role: "System" }
        ]
    });

    const gateway = normalized.steps.find((step) => step.id === "step_2");
    const noBranch = gateway.conditions.find((cond) => String(cond.label).toLowerCase().includes("nicht"));
    assert.equal(noBranch?.target, "step_3");
});

test("buildOptimizationGuidanceFromKnowledgeBase formats rule snippets", () => {
    const guidance = buildOptimizationGuidanceFromKnowledgeBase({
        instructions: [
            {
                priority: "should",
                category: "gateways",
                title: "Use explicit branch labels",
                guideline: "Use Ja/Nein labels for binary decisions."
            },
            {
                priority: "must",
                category: "events",
                title: "Use end events",
                guideline: "Always end with explicit end events."
            }
        ],
        antiPatterns: [
            {
                name: "Unlabeled branches",
                fix: "Add branch labels."
            }
        ],
        qualityChecklist: [
            "At least one end event exists."
        ]
    });

    assert.ok(guidance.includes("BPMN-REGELN"));
    assert.ok(guidance.includes("ZU VERMEIDENDE MUSTER"));
    assert.ok(guidance.includes("QUALITAETSCHECK"));
    assert.ok(guidance.includes("Ja/Nein"));
    assert.ok(guidance.includes("[MUST]"));
    assert.ok(guidance.indexOf("Use end events") < guidance.indexOf("Use explicit branch labels"));
});

test("buildAnalyzePrompt includes optional learning guidance", () => {
    const prompt = buildAnalyzePrompt("Ein Kunde bestellt.", "LERNREGELN AUS FRUEHEREN MODELLEN:\n- DEAD_END vermeiden");
    assert.ok(prompt.includes("LERNREGELN AUS FRUEHEREN MODELLEN"));
    assert.ok(prompt.includes("DEAD_END"));
    assert.ok(prompt.includes("Statuswerte wie"));
});

test("buildOptimizationPrompt enforces BPMN oriented schema output", () => {
    const prompt = buildOptimizationPrompt("Ein Kunde bestellt Waren.", "BPMN-Hinweis");
    assert.ok(prompt.includes("AUSGABESCHEMA"));
    assert.ok(prompt.includes("Rollen: <kommagetrennte Rollen>"));
    assert.ok(prompt.includes("Schritt 1: Rolle="));
    assert.ok(prompt.includes("Entscheidung 1: Frage="));
    assert.ok(prompt.includes("Zeitachse: Schritt 1 ->"));
});

test("buildSemanticIRFromProcess derives dependencies and ambiguity flags", () => {
    const process = {
        roles: ["System"],
        steps: [
            { id: "step_1", type: "task", label: "Eingang pruefen", role: "System", next: ["step_2"] },
            {
                id: "step_2",
                type: "gateway",
                label: "Freigabe",
                role: "",
                conditions: [
                    { label: "Pfad A", target: "step_3" },
                    { label: "Pfad B", target: "step_4" }
                ]
            },
            { id: "step_3", type: "task", label: "Bearbeiten", role: "Team A / Team B", next: ["step_5"] },
            { id: "step_4", type: "task", label: "Korrigieren", role: "System", next: ["step_5"] },
            { id: "step_5", type: "end", label: "Ende", role: "System" }
        ]
    };
    const ir = buildSemanticIRFromProcess(process, "Schritt 1: Eingang pruefen");
    const gatewayIR = ir.steps.find((step) => step.id === "step_2");
    const multiRoleIR = ir.steps.find((step) => step.id === "step_3");

    assert.equal(ir.version, "v1");
    assert.ok(Array.isArray(ir.steps) && ir.steps.length === 5);
    assert.ok(gatewayIR.dependsOn.includes("step_1"));
    assert.ok(gatewayIR.ambiguityFlags.includes("MISSING_ROLE"));
    assert.ok(gatewayIR.ambiguityFlags.includes("UNCLEAR_DECISION"));
    assert.ok(multiRoleIR.ambiguityFlags.includes("MULTI_ROLE_STEP"));
});

test("prevalidateSemanticProcess rejects invalid flow targets early", () => {
    assert.throws(
        () => prevalidateSemanticProcess({
            roles: ["System"],
            steps: [
                { id: "step_1", type: "task", role: "System", next: ["step_404"] },
                { id: "step_2", type: "end", role: "System" }
            ]
        }),
        /SEMANTIC_PREVALIDATION_FAILED|Ungueltiges next-Target/
    );
});

test("normalizeProcessJson integrates semantic IR metadata", () => {
    const normalized = normalizeProcessJson({
        roles: ["System"],
        _ambiguityFlags: ["MISSING_END_HINT"],
        _semanticIR: {
            version: "v1",
            processFlags: ["MISSING_END_HINT"],
            steps: [
                {
                    id: "step_1",
                    role: "System",
                    activity: "Pruefung",
                    statusHint: "in Bearbeitung",
                    dependsOn: [],
                    confidence: 0.8,
                    ambiguityFlags: []
                }
            ]
        },
        steps: [
            { id: "step_1", type: "task", label: "Pruefung", role: "System" }
        ]
    });

    const step1 = normalized.steps.find((step) => step.id === "step_1");
    assert.ok(step1.documentation.includes("Statushinweis: in Bearbeitung"));
    assert.equal(Array.isArray(normalized.analysisMeta?.ambiguityFlags), true);
    assert.equal(normalized.analysisMeta.semanticVersion, "v1");
    assert.ok(!("_semanticIR" in normalized));
});

test("buildBpmnQualityScorecard detects dead ends and scores model", () => {
    const scorecard = buildBpmnQualityScorecard({
        roles: ["System"],
        steps: [
            { id: "step_1", type: "task", role: "System", label: "Pruefen" }
        ]
    });

    assert.equal(typeof scorecard.percent, "number");
    assert.ok(scorecard.violations.some((v) => v.code === "DEAD_END_ACTIVITY"));
    assert.ok(scorecard.score < scorecard.maxScore);
});

test("buildBpmnQualityScorecard keeps routing anchor rules consistent with fallback routing", () => {
    const scorecard = buildBpmnQualityScorecard({
        roles: ["System"],
        steps: [
            {
                id: "step_1",
                type: "gateway",
                role: "System",
                label: "Route?",
                conditions: [
                    { label: "A", target: "step_2" },
                    { label: "B", target: "step_3" }
                ]
            },
            { id: "step_2", type: "task", role: "System", label: "Pfad A", next: ["step_4"] },
            { id: "step_3", type: "task", role: "System", label: "Pfad B", next: ["step_4"] },
            { id: "step_4", type: "end", role: "System", label: "Ende" }
        ]
    });

    assert.ok(!scorecard.violations.some((v) => v.code === "ROUTING_ANCHOR_RULE_BROKEN"));
    const routingCheck = scorecard.checks.find((check) => check.id === "check_routing_anchor_rules");
    assert.equal(routingCheck?.ok, true);
});

test("buildBpmnQualityScorecard counts layout collisions from BPMN xml", () => {
    const processJson = {
        roles: ["System"],
        steps: [
            { id: "step_1", type: "task", role: "System", label: "A", next: ["step_2"] },
            { id: "step_2", type: "task", role: "System", label: "B", next: ["step_3"] },
            { id: "step_3", type: "end", role: "System", label: "Ende" },
            { id: "step_4", type: "task", role: "System", label: "Hilfsknoten" }
        ]
    };
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions>
<bpmn:process>
<bpmn:sequenceFlow id="flow_0" sourceRef="step_1" targetRef="step_2" />
<bpmn:sequenceFlow id="flow_1" sourceRef="step_2" targetRef="step_3" />
</bpmn:process>
<bpmndi:BPMNDiagram><bpmndi:BPMNPlane>
<bpmndi:BPMNShape bpmnElement="step_1"><dc:Bounds x="100" y="100" width="80" height="48" /></bpmndi:BPMNShape>
<bpmndi:BPMNShape bpmnElement="step_2"><dc:Bounds x="130" y="110" width="80" height="48" /></bpmndi:BPMNShape>
<bpmndi:BPMNShape bpmnElement="step_3"><dc:Bounds x="260" y="100" width="80" height="48" /></bpmndi:BPMNShape>
<bpmndi:BPMNEdge bpmnElement="flow_0">
<di:waypoint x="180" y="124" /><di:waypoint x="320" y="124" /><di:waypoint x="320" y="220" />
</bpmndi:BPMNEdge>
<bpmndi:BPMNEdge bpmnElement="flow_1">
<di:waypoint x="250" y="80" /><di:waypoint x="250" y="200" /><di:waypoint x="360" y="200" />
</bpmndi:BPMNEdge>
</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const scorecard = buildBpmnQualityScorecard(processJson, { xml });
    assert.ok(scorecard.metrics.elementOverlaps > 0);
    assert.ok(scorecard.metrics.flowCrossingsTotal > 0);
    assert.ok(scorecard.violations.some((v) => v.code === "LAYOUT_COLLISIONS_DETECTED"));
    assert.equal(typeof scorecard.gate?.severity, "string");
    assert.equal(Array.isArray(scorecard.gate?.reasons), true);
});

test("buildBpmnQualityScorecard gate ignores minor layout noise on simple process", () => {
    const scorecard = buildBpmnQualityScorecard({
        roles: ["System"],
        steps: [
            { id: "step_1", type: "task", role: "System", label: "A", next: ["step_2"] },
            { id: "step_2", type: "end", role: "System", label: "Ende" }
        ]
    }, {
        diagramMetrics: {
            elementOverlaps: 0,
            flowCrossingsTotal: 1,
            flowCrossingsNecessary: 0,
            flowCrossingsAvoidable: 1,
            flowShapeOverlaps: 1,
            outOfWorkspaceFlows: 0
        }
    });

    assert.equal(scorecard.gate.needsRelayout, false);
    assert.equal(scorecard.gate.blocking, false);
    assert.equal(scorecard.gate.severity, "info");
});

test("buildBpmnQualityScorecard blocks severe avoidable crossings on simple process", () => {
    const scorecard = buildBpmnQualityScorecard({
        roles: ["System"],
        steps: [
            { id: "step_1", type: "task", role: "System", label: "A", next: ["step_2"] },
            { id: "step_2", type: "end", role: "System", label: "Ende" }
        ]
    }, {
        diagramMetrics: {
            elementOverlaps: 0,
            flowCrossingsTotal: 7,
            flowCrossingsNecessary: 1,
            flowCrossingsAvoidable: 5,
            flowShapeOverlaps: 0,
            outOfWorkspaceFlows: 0
        }
    });

    assert.equal(scorecard.gate.needsRelayout, true);
    assert.equal(scorecard.gate.blocking, true);
    assert.ok(scorecard.gate.reasons.includes("flowCrossingsAvoidable"));
});

test("buildBpmnQualityScorecard keeps heavy but mostly necessary crossings non-blocking", () => {
    const scorecard = buildBpmnQualityScorecard({
        roles: ["System"],
        steps: [
            { id: "step_1", type: "task", role: "System", label: "A", next: ["step_2"] },
            { id: "step_2", type: "end", role: "System", label: "Ende" }
        ]
    }, {
        diagramMetrics: {
            elementOverlaps: 0,
            flowCrossingsTotal: 28,
            flowCrossingsNecessary: 22,
            flowCrossingsAvoidable: 6,
            flowShapeOverlaps: 0,
            outOfWorkspaceFlows: 0
        }
    });

    assert.equal(scorecard.gate.needsRelayout, true);
    assert.equal(scorecard.gate.blocking, false);
    assert.equal(scorecard.gate.severity, "warn");
    assert.ok(scorecard.gate.reasons.includes("flowCrossingsAvoidable"));
});

test("analyzeBpmnDiagram ignores tiny interior touch as flow-shape overlap", () => {
    const processJson = {
        roles: ["System"],
        steps: [
            { id: "step_1", type: "task", role: "System", label: "A", next: ["step_2"] },
            { id: "step_2", type: "task", role: "System", label: "B", next: ["step_3"] },
            { id: "step_3", type: "end", role: "System", label: "Ende" }
        ]
    };
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions>
<bpmn:process>
<bpmn:sequenceFlow id="flow_0" sourceRef="step_1" targetRef="step_3" />
<bpmn:sequenceFlow id="flow_1" sourceRef="step_2" targetRef="step_3" />
</bpmn:process>
<bpmndi:BPMNDiagram><bpmndi:BPMNPlane>
<bpmndi:BPMNShape bpmnElement="step_1"><dc:Bounds x="100" y="100" width="80" height="48" /></bpmndi:BPMNShape>
<bpmndi:BPMNShape bpmnElement="step_2"><dc:Bounds x="180" y="200" width="80" height="48" /></bpmndi:BPMNShape>
<bpmndi:BPMNShape bpmnElement="step_3"><dc:Bounds x="300" y="100" width="80" height="48" /></bpmndi:BPMNShape>
<bpmndi:BPMNShape bpmnElement="step_4"><dc:Bounds x="180" y="112" width="6" height="24" /></bpmndi:BPMNShape>
<bpmndi:BPMNEdge bpmnElement="flow_0">
<di:waypoint x="180" y="124" /><di:waypoint x="183" y="124" /><di:waypoint x="300" y="124" />
</bpmndi:BPMNEdge>
<bpmndi:BPMNEdge bpmnElement="flow_1">
<di:waypoint x="260" y="224" /><di:waypoint x="300" y="224" /><di:waypoint x="300" y="124" />
</bpmndi:BPMNEdge>
</bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;

    const metrics = analyzeBpmnDiagram(xml, processJson);
    assert.equal(metrics.flowShapeOverlaps, 0);
});
