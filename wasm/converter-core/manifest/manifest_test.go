package manifest

import "testing"

func TestConversionPairLookupNormalizesInputs(t *testing.T) {
	for _, pair := range [][2]string{
		{".PPT", " PPTX "},
		{"rtf", "docx"},
		{"cr2", "jpg"},
	} {
		if !IsSupportedConversionPair(pair[0], pair[1]) {
			t.Fatalf("expected supported conversion %q -> %q", pair[0], pair[1])
		}
	}
	if IsSupportedConversionPair("ppt", "pdf") {
		t.Fatal("unexpected conversion ppt -> pdf")
	}
}

func TestDefaultTargetsUseFirstManifestPair(t *testing.T) {
	if target := OpenXMLTargetsBySource()["cr2"]; target != "jpg" {
		t.Fatalf("RAW default target = %q, want jpg", target)
	}
}

func TestSupportedConversionsReturnsACopy(t *testing.T) {
	conversions := SupportedConversions()
	conversions[0] = ConversionPair{SourceFormat: "dwg", TargetFormat: "pdf"}
	if SupportedConversions()[0].SourceFormat == "dwg" {
		t.Fatal("SupportedConversions must not expose mutable manifest storage")
	}
}
