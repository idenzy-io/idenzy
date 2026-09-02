import { IdenzyError } from "./idenzy-error.js";

/** 400. The request was understood and is wrong. */
export abstract class BadRequestError extends IdenzyError {
  override readonly status = 400;
}

/** 401. The caller or end user did not prove who they are. */
export abstract class UnauthorizedError extends IdenzyError {
  override readonly status = 401;
}

/** 403. Identity is established; the action is not permitted. */
export abstract class ForbiddenError extends IdenzyError {
  override readonly status = 403;
}

/** 404. Also used where 403 would confirm existence to an attacker. */
export abstract class NotFoundError extends IdenzyError {
  override readonly status = 404;
}

/** 409. The request conflicts with current state. */
export abstract class ConflictError extends IdenzyError {
  override readonly status = 409;
}

/** 429. Always carries retryAfterSeconds. */
export abstract class TooManyRequestsError extends IdenzyError {
  override readonly status = 429;
}

/** 500. Never carries detail into the response. */
export abstract class ServerError extends IdenzyError {
  override readonly status = 500;
}

/** 502. A dependency we do not control failed. */
export abstract class UpstreamError extends IdenzyError {
  override readonly status = 502;
}
