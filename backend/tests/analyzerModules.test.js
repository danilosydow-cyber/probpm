import test from "node:test";
import assert from "node:assert/strict";

import { parseAnalyzerResponse } from "../services/analyzer/parseResponse.js";
import { validateProcessShape } from "../services/analyzer/validateProcess.js";
import { normalizeProcessJson } from "../services/analyzer/normalizeProcess.js";

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
