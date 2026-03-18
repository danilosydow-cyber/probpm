import React, { useState } from "react";
import Upload from "./components/Upload";
import BpmnEditor from "./BpmnEditor";

function App() {

  const [bpmnXML, setBpmnXML] = useState(null);

  return (
    <div style={{ display: "flex", height: "100vh" }}>

      <div style={{ width: "300px", padding: "20px" }}>
        <Upload setBpmnXML={setBpmnXML} />
      </div>

      <div style={{ flex: 1 }}>
        <BpmnEditor bpmnXML={bpmnXML} />
      </div>

    </div>
  );
}

export default App;