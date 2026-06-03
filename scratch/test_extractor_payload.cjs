const { extractRawData } = require('../connectors/omie/extractor.js');

// Mock axios to intercept the request and print it
const mockAxios = async (config) => {
  console.log("=== INTERCEPTED REQUEST ===");
  console.log(JSON.stringify(config, null, 2));
  console.log("===========================");
  // Throw an error to stop the loop
  const err = new Error("Stop");
  err.response = { status: 404 };
  throw err;
};

// Override axios in the require cache
const Module = require('module');
const originalRequire = Module.prototype.require;
Module.prototype.require = function(path) {
  if (path === 'axios') return mockAxios;
  return originalRequire.apply(this, arguments);
};

async function run() {
  try {
    await extractRawData(
      { app_key: "test_key", app_secret: "test_secret" },
      "invoices",
      "https://mock/"
    );
  } catch (err) {
    if (err.message !== "Stop") {
      console.error("Test failed:", err);
    }
  }
}
run();
