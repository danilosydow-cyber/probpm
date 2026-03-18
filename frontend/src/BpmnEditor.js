import React, { useEffect, useRef } from "react";
import BpmnModeler from "bpmn-js/lib/Modeler";

import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";

const BpmnEditor = ({ bpmnXML }) => {
  const containerRef = useRef(null);
  const modelerRef = useRef(null);

  useEffect(() => {

    if (!containerRef.current) return;

    // Modeler erstellen
   const modeler = new BpmnModeler({
  container: containerRef.current
});

    modelerRef.current = modeler;

    return () => {
      modeler.destroy();
    };

  }, []);

  useEffect(() => {

    async function loadDiagram() {

      if (!bpmnXML || !modelerRef.current) return;

      try {

        await modelerRef.current.importXML(bpmnXML);

        const canvas = modelerRef.current.get("canvas");

        canvas.zoom("fit-viewport");

      } catch (err) {
        console.error("Fehler beim Laden des BPMN:", err);
      }

    }

    loadDiagram();

  }, [bpmnXML]);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: "600px",
        border: "1px solid #ccc",
        background: "white"
      }}
    />
  );
};

export default BpmnEditor;