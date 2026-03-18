export async function analyzeProcess(text) {
    const response = await fetch("http://localhost:5000/analyze", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ text })
    });

    return response.json();
}