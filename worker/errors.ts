export class ApiError extends Error {
  constructor(readonly status: 400 | 401 | 402 | 403 | 404 | 409 | 413 | 415 | 429 | 503, message: string, readonly code = 'REQUEST_FAILED') { super(message); }
}
