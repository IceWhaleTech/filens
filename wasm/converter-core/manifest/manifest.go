package manifest

import (
	_ "embed"
	"encoding/json"
	"strings"
)

type ConversionPair struct {
	SourceFormat string `json:"sourceFormat"`
	TargetFormat string `json:"targetFormat"`
}

//go:embed conversions.json
var conversionsJSON []byte

var supportedOpenXMLConversions = mustDecodeConversions(conversionsJSON)

func SupportedConversions() []ConversionPair {
	conversions := make([]ConversionPair, len(supportedOpenXMLConversions))
	copy(conversions, supportedOpenXMLConversions)
	return conversions
}

func OpenXMLTargetsBySource() map[string]string {
	targets := map[string]string{}
	for _, pair := range supportedOpenXMLConversions {
		if _, exists := targets[pair.SourceFormat]; !exists {
			targets[pair.SourceFormat] = pair.TargetFormat
		}
	}
	return targets
}

func IsSupportedConversionPair(sourceFormat string, targetFormat string) bool {
	sourceFormat = NormalizeFormat(sourceFormat)
	targetFormat = NormalizeFormat(targetFormat)
	for _, pair := range supportedOpenXMLConversions {
		if pair.SourceFormat == sourceFormat && pair.TargetFormat == targetFormat {
			return true
		}
	}
	return false
}

func NormalizeFormat(format string) string {
	return strings.TrimPrefix(strings.ToLower(strings.TrimSpace(format)), ".")
}

func mustDecodeConversions(data []byte) []ConversionPair {
	var conversions []ConversionPair
	if err := json.Unmarshal(data, &conversions); err != nil {
		panic("decode converter manifest: " + err.Error())
	}
	for index, pair := range conversions {
		conversions[index] = ConversionPair{
			SourceFormat: NormalizeFormat(pair.SourceFormat),
			TargetFormat: NormalizeFormat(pair.TargetFormat),
		}
	}
	return conversions
}
