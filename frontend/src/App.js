import React, { useState } from "react";
import "./App.css";

import Upload from "./components/Upload";
import BpmnEditor from "./components/BpmnEditor";

function App() {
    const [xml, setXml] = useState("");

    return (
        <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>

            {/* LEFT */}
            <div style={{ width: "300px", borderRight: "1px solid #ccc" }}>
                <Upload setBpmnXml={setXml} />
            </div>

            {/* RIGHT */}
            <div style={{ flex: 1, height: "100%", position: "relative" }}>
                <BpmnEditor bpmnXML={xml} />
            </div>

        </div>
    );
}

export default App;