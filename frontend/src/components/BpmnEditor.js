import React, { useEffect, useRef } from "react";
import BpmnJS from "bpmn-js/dist/bpmn-modeler.production.min.js";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";

export default function BpmnEditor({ bpmnXML }) {
    const containerRef = useRef(null);
    const modelerRef = useRef(null);

    useEffect(() => {
        modelerRef.current = new BpmnJS({
            container: containerRef.current,
        });

        return () => {
            modelerRef.current?.destroy();
        };
    }, []);

    useEffect(() => {
        if (!bpmnXML || !modelerRef.current) return;

        modelerRef.current.importXML(bpmnXML).then(() => {
            const canvas = modelerRef.current.get("canvas");

            // ✅ EINMAL definieren und benutzen
            canvas.zoom("fit-viewport", {
                padding: 80
            });
        }).catch(err => {
            console.error("Fehler beim Laden:", err);
        });

    }, [bpmnXML]);

    return (
        <div
            ref={containerRef}
            style={{
                width: "100%",
                height: "100%",
            }}
        />
    );
}