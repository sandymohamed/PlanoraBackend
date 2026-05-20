/**
 * Patches Express Router so async route handlers rejections reach errorHandler via next().
 * Import once at process startup (before routes are registered).
 */
import { Router, RequestHandler } from 'express';
import { asyncHandler } from '../middleware/asyncHandler';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'all'] as const;

function wrapIfAsync(fn: RequestHandler): RequestHandler {
  if (fn.length >= 4) return fn;
  return asyncHandler(fn as Parameters<typeof asyncHandler>[0]);
}

for (const method of METHODS) {
  const original = Router.prototype[method] as (...args: unknown[]) => ReturnType<Router['get']>;

  Router.prototype[method] = function (this: Router, ...args: unknown[]) {
    const wrapped = args.map((arg) => (typeof arg === 'function' ? wrapIfAsync(arg as RequestHandler) : arg));
    return original.apply(this, wrapped);
  };
}
