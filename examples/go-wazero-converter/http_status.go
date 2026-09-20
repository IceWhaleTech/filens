package converter

import (
	"net/http"
	"strings"
)

func HTTPStatusFromResult(result Result) int {
	if result.OK {
		return http.StatusOK
	}

	switch strings.TrimSpace(result.ErrorCode) {
	case ErrorCodeUnsupportedFormat:
		return http.StatusUnsupportedMediaType
	case ErrorCodePasswordRequired, ErrorCodePasswordInvalid:
		return http.StatusUnauthorized
	case ErrorCodeParse:
		return http.StatusUnprocessableEntity
	case ErrorCodeConversionFailed:
		return http.StatusBadGateway
	case ErrorCodeEngineUnavailable:
		return http.StatusServiceUnavailable
	case ErrorCodeIO:
		return http.StatusInternalServerError
	default:
		return http.StatusInternalServerError
	}
}
