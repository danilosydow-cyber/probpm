export async function generateBpmn(process) {

    if (!process || !process.steps || !process.flows) {
        throw new Error("Invalid process");
    }

    const nameToId = {};
    process.steps.forEach(step => {
        nameToId[step.name?.toLowerCase()] = step.id;
    });

    let x = 150;
    let y = 100;

    const positions = {};

    let elementsXML = "";
    let flowsXML = "";
    let shapesXML = "";
    let edgesXML = "";

    /*
    STEPS
    */
    process.steps.forEach((step) => {

        positions[step.id] = { x, y };

        elementsXML += `
<bpmn:${step.type} id="${step.id}" name="${step.name || ""}" />`;

        shapesXML += `
<bpmndi:BPMNShape id="${step.id}_di" bpmnElement="${step.id}">
  <dc:Bounds x="${x}" y="${y}" width="100" height="80"/>
</bpmndi:BPMNShape>`;

        x += 200;
    });

    /*
    FLOWS
    */
    process.flows.forEach((flow, index) => {

        let source = flow.source || flow.from;
        let target = flow.target || flow.to;

        if (!positions[source]) {
            source = nameToId[source?.toLowerCase()];
        }

        if (!positions[target]) {
            target = nameToId[target?.toLowerCase()];
        }

        if (!positions[source] || !positions[target]) return;

        const id = `Flow_${index}`;

        flowsXML += `
<bpmn:sequenceFlow id="${id}" sourceRef="${source}" targetRef="${target}" />`;

        const start = positions[source];
        const end = positions[target];

        edgesXML += `
<bpmndi:BPMNEdge id="${id}_di" bpmnElement="${id}">
  <di:waypoint x="${start.x + 100}" y="${start.y + 40}" />
  <di:waypoint x="${end.x}" y="${end.y + 40}" />
</bpmndi:BPMNEdge>`;
    });

    return `<?xml version="1.0" encoding="UTF-8"?>

<bpmn:definitions
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
 xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
 xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
 xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
 xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
 targetNamespace="http://bpmn.io/schema/bpmn">

<bpmn:process id="Process_1" isExecutable="false">
${elementsXML}
${flowsXML}
</bpmn:process>

<bpmndi:BPMNDiagram id="BPMNDiagram_1">
<bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">

${shapesXML}
${edgesXML}

</bpmndi:BPMNPlane>
</bpmndi:BPMNDiagram>

</bpmn:definitions>`;
}