import { ZodError } from 'zod';

import { AppError, ValidationError } from './errors.js';

/** Wraps an async route handler so rejected promises reach the error middleware. */
export const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

export function parseBody(schema, body) {
  try {
    return schema.parse(body);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new ValidationError(
        'Request body failed validation',
        error.issues.map(({ path, message }) => ({ field: path.join('.'), message })),
      );
    }
    throw error;
  }
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.originalUrl}` } });
}

// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity.
export function errorHandler(error, req, res, next) {
  if (error instanceof AppError) {
    return res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details },
    });
  }

  if (error?.name === 'CastError') {
    return res
      .status(400)
      .json({ error: { code: 'INVALID_ID', message: `${error.value} is not a valid id` } });
  }

  if (error?.code === 11000) {
    return res.status(409).json({
      error: {
        code: 'DUPLICATE_KEY',
        message: 'That record already exists',
        details: error.keyValue,
      },
    });
  }

  console.error('[unhandled]', error);
  return res
    .status(500)
    .json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong' } });
}
