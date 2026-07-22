export class SourceSelectionError extends Error {
    code;
    candidates;
    constructor(code, message, candidates = []) {
        super(message);
        this.code = code;
        this.candidates = candidates;
        this.name = "SourceSelectionError";
    }
}
export class SourceCaptureError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "SourceCaptureError";
    }
}
