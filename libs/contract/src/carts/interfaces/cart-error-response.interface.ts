export interface CartErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, any>;
    suggestedAction?: string;
  };
}
