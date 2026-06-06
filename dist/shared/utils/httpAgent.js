"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDevHttpsAgent = createDevHttpsAgent;
const https_1 = __importDefault(require("https"));
/**
 * Node on Windows / corporate networks may fail TLS with UNABLE_TO_VERIFY_LEAF_SIGNATURE
 * for OpenAI and other HTTPS APIs. In development, skip verification unless explicitly enabled.
 */
function createDevHttpsAgent() {
    const strict = process.env.NODE_TLS_REJECT_UNAUTHORIZED === '1' ||
        process.env.OPENAI_TLS_REJECT_UNAUTHORIZED === 'true';
    if (process.env.NODE_ENV === 'production' || strict) {
        return undefined;
    }
    return new https_1.default.Agent({ rejectUnauthorized: false });
}
