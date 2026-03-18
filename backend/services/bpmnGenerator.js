import { layoutProcess } from "bpmn-auto-layout";

export async function generateBpmn(process) {

  /*
  LANE NODE MAPPING
  */

  const laneNodeMap = {};

  if (process.lanes) {
    process.lanes.forEach(lane => {
      laneNodeMap[lane.name] = [];
    });
  }

  if (process.tasks) {
    process.tasks.forEach(task => {
      if (task.lane && laneNodeMap[task.lane]) {
        laneNodeMap[task.lane].push(task.id);
      }
    });
  }

  /*
  LANES XML
  */

  let lanesXML = "";

  if (process.lanes) {

    process.lanes.forEach(lane => {

      let nodeRefs = "";

      if (laneNodeMap[lane.name]) {
        laneNodeMap[lane.name].forEach(nodeId => {
          nodeRefs += `<bpmn:flowNodeRef>${nodeId}</bpmn:flowNodeRef>`;
        });
      }

      lanesXML += `
<bpmn:lane id="${lane.id}" name="${lane.name}">
${nodeRefs}
</bpmn:lane>`;

    });

  }

  /*
  TASKS
  */

  let tasksXML = "";

  process.tasks.forEach(task => {

    tasksXML += `
<bpmn:task id="${task.id}" name="${task.name}" />`;

  });

  /*
  GATEWAYS
  */

  let gatewaysXML = "";

  if (process.gateways) {

    process.gateways.forEach(gateway => {

      if (gateway.type === "exclusive") {

        gatewaysXML += `
<bpmn:exclusiveGateway id="${gateway.id}" />`;

      }

    });

  }

  /*
  FLOWS
  */

  let flowsXML = "";

  process.flows.forEach((flow, index) => {

    flowsXML += `
<bpmn:sequenceFlow
 id="Flow_${index}"
 sourceRef="${flow.source}"
 targetRef="${flow.target}" />`;

  });

  /*
  LANE SET
  */

  let laneSetXML = "";

  if (lanesXML !== "") {

    laneSetXML = `
<bpmn:laneSet id="LaneSet_1">
${lanesXML}
</bpmn:laneSet>`;

  }

  /*
  BPMN BASIS
  */

  const baseBpmn = `<?xml version="1.0" encoding="UTF-8"?>

<bpmn:definitions
 xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
 xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
 xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
 xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
 xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
 targetNamespace="http://bpmn.io/schema/bpmn">

<bpmn:process id="Process_1" isExecutable="false">

${laneSetXML}

<bpmn:startEvent id="StartEvent_1" />

${tasksXML}

${gatewaysXML}

<bpmn:endEvent id="EndEvent_1" />

${flowsXML}

</bpmn:process>

</bpmn:definitions>`;

  /*
  AUTO LAYOUT
  */

  const xmlWithLayout = await layoutProcess(baseBpmn);

  return xmlWithLayout;

}