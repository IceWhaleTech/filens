package converter

import "strings"

const (
	ExitCodeUsage             = 1
	ExitCodeUnsupportedFormat = 2
	ExitCodePasswordRequired  = 3
	ExitCodePasswordInvalid   = 4
	ExitCodeParseError        = 5
	ExitCodeConversionFailed  = 6
	ExitCodeIOError           = 7
	ExitCodeEngineUnavailable = 8
)

func ExitCodeFromResult(result Result) int {
	if result.OK {
		return 0
	}

	switch strings.TrimSpace(result.ErrorCode) {
	case ErrorCodeUnsupportedFormat:
		return ExitCodeUnsupportedFormat
	case ErrorCodePasswordRequired:
		return ExitCodePasswordRequired
	case ErrorCodePasswordInvalid:
		return ExitCodePasswordInvalid
	case ErrorCodeParse:
		return ExitCodeParseError
	case ErrorCodeConversionFailed:
		return ExitCodeConversionFailed
	case ErrorCodeIO:
		return ExitCodeIOError
	case ErrorCodeEngineUnavailable:
		return ExitCodeEngineUnavailable
	}

	if result.ExitCode != 0 {
		return int(result.ExitCode)
	}

	return ExitCodeUsage
}

func ExitCodeFromReport(report BatchReport) int {
	if report.OK {
		return 0
	}

	for _, item := range report.Results {
		if code := ExitCodeFromResult(item.Result); code != 0 {
			return code
		}
	}

	return ExitCodeUsage
}

func ExitCodeFromCapabilities(capabilities ConverterCapabilities) int {
	if capabilities.OK {
		return 0
	}
	return ExitCodeFromResult(Result{
		ErrorCode:    capabilities.ErrorCode,
		ErrorMessage: capabilities.ErrorMessage,
	})
}
