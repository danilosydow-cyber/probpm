import test from "node:test";
import assert from "node:assert/strict";

import { generateBPMN } from "../services/bpmnGenerator.js";

test("generateBPMN returns valid core XML sections", () => {
    const process = {
        roles: ["Sales", "Finance"],
        steps: [
            {
                id: "step_1",
                type: "task",
                label: "Anfrage prüfen",
                role: "Sales",
                next: ["step_2"]
            },
            {
                id: "step_2",
                type: "gateway",
                label: "Budget > 1000?",
                role: "Finance",
                conditions: [
                    { label: "Ja", target: "step_3" },
                    { label: "Nein", target: "step_4" }
                ]
            },
            {
                id: "step_3",
                type: "end",
                label: "Freigeben",
                role: "Finance"
            },
            {
                id: "step_4",
                type: "end",
                label: "Ablehnen",
                role: "Sales"
            }
        ]
    };

    const xml = generateBPMN(process);

    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
    assert.ok(xml.includes("<bpmn:definitions"));
    assert.ok(xml.includes("<bpmn:laneSet id=\"LaneSet_1\">"));
    assert.ok(xml.includes("<bpmn:startEvent"));
    assert.ok(xml.includes("<bpmn:exclusiveGateway"));
    assert.ok(xml.includes("<bpmn:endEvent"));
    assert.ok(xml.includes("<bpmndi:BPMNDiagram>"));
    assert.ok(xml.includes("</bpmn:definitions>"));
});

test("generateBPMN escapes XML special characters", () => {
    const process = {
        roles: ["R&D"],
        steps: [
            {
                id: "step_1",
                type: "task",
                label: "Check <input> & confirm",
                role: "R&D"
            }
        ]
    };

    const xml = generateBPMN(process);
    assert.ok(xml.includes("Check &lt;input&gt; &amp;"));
    assert.ok(xml.includes("R&amp;D"));
});
