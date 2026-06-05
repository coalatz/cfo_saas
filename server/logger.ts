import { AsyncLocalStorage } from "async_hooks";

export const pipelineLocalStorage = new AsyncLocalStorage<{ pipelineId: number }>();

const MAX_LOGS_PER_PIPELINE = 50;

// Em memória
export const pipelineLogsMap = new Map<number, { timestamp: Date; level: string; message: string }[]>();

export function getLogs(pipelineId: number) {
  return pipelineLogsMap.get(pipelineId) || [];
}

export function clearLogs(pipelineId: number) {
  pipelineLogsMap.delete(pipelineId);
}

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;
const originalInfo = console.info;

function formatArgs(args: any[]) {
  return args
    .map(a => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)))
    .join(" ");
}

function captureLog(level: string, args: any[]) {
  const store = pipelineLocalStorage.getStore();
  if (store?.pipelineId) {
    const pipelineId = store.pipelineId;
    const msg = formatArgs(args);
    let logs = pipelineLogsMap.get(pipelineId);
    if (!logs) {
      logs = [];
      pipelineLogsMap.set(pipelineId, logs);
    }
    logs.push({ timestamp: new Date(), level, message: msg });
    if (logs.length > MAX_LOGS_PER_PIPELINE) {
      logs.shift(); // keep only last 50
    }
  }
}

console.log = function (...args: any[]) {
  originalLog.apply(console, args);
  captureLog("info", args);
};

console.info = function (...args: any[]) {
  originalInfo.apply(console, args);
  captureLog("info", args);
};

console.warn = function (...args: any[]) {
  originalWarn.apply(console, args);
  captureLog("warn", args);
};

console.error = function (...args: any[]) {
  originalError.apply(console, args);
  captureLog("error", args);
};
