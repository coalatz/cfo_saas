async function test() {
  try {
    console.log("Testing connection to localhost:11434...");
    const response = await fetch("http://localhost:11434/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "nemotron-3-super:cloud",
        messages: [{ role: "user", content: "Hello, reply with OK" }]
      })
    });
    console.log("Status:", response.status);
    const text = await response.text();
    console.log("Body:", text);
  } catch (e) {
    console.error("Error:", e);
  }
}

test();
