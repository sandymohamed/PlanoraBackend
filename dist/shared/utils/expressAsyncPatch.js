"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Patches Express Router so async route handlers rejections reach errorHandler via next().
 * Import once at process startup (before routes are registered).
 */
const express_1 = require("express");
const asyncHandler_1 = require("../middleware/asyncHandler");
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all'];
function wrapIfAsync(fn) {
    if (fn.length >= 4)
        return fn;
    return (0, asyncHandler_1.asyncHandler)(fn);
}
for (const method of METHODS) {
    const original = express_1.Router.prototype[method];
    express_1.Router.prototype[method] = function (...args) {
        const wrapped = args.map((arg) => (typeof arg === 'function' ? wrapIfAsync(arg) : arg));
        return original.apply(this, wrapped);
    };
}
