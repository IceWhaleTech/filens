package converter

import "github.com/IceWhaleTech/filens/wasm/converter-core/manifest"

var openXMLTargetsBySource = manifest.OpenXMLTargetsBySource()

func SupportedConversions() []ConversionPair {
	return manifest.SupportedConversions()
}

func isSupportedConversionPair(sourceFormat string, targetFormat string) bool {
	return manifest.IsSupportedConversionPair(sourceFormat, targetFormat)
}
