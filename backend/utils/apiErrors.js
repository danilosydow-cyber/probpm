export class AppError extends Error {
    constructor(code, message, status = 500, details = null) {
        super(message);
        this.name = "AppError";
        this.code = code;
        this.status = status;
        this.details = details;
    }
}

export function badRequest(message, details = null, code = "INVALID_INPUT") {
    return new AppError(code, message, 400, details);
}

export function toErrorResponse(error) {
    if (error instanceof AppError) {
        return {
            status: error.status,
            body: {
                success: false,
                error: error.message,
                code: error.code,
                details: error.details ?? undefined
            }
        };
    }

    return {
        status: 500,
        body: {
            success: false,
            error: "Interner Serverfehler",
            code: "INTERNAL_ERROR"
        }
    };
}
