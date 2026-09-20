package converter

const (
	ConversionFidelityLightweight = "lightweight"
	ConversionFidelityWASI        = "wasi"
)

func fidelityForBackend(backendName string) string {
	switch backendName {
	case "wasi":
		return ConversionFidelityWASI
	default:
		return ""
	}
}

func markResultFidelity(result Result) Result {
	if result.Fidelity == "" && result.Backend != "" {
		result.Fidelity = fidelityForBackend(result.Backend)
	}
	return result
}
