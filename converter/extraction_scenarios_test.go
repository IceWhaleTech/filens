package converter

import (
	"archive/zip"
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
	"unicode/utf8"
)

func zipFixture(t *testing.T, ext string, parts map[string]string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "fixture."+ext)
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	z := zip.NewWriter(file)
	for name, value := range parts {
		w, err := z.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = w.Write([]byte(value)); err != nil {
			t.Fatal(err)
		}
	}
	if err := errors.Join(z.Close(), file.Close()); err != nil {
		t.Fatal(err)
	}
	return path
}
func TestEmbeddedOCROrderDedupAndFailure(t *testing.T) {
	for _, fail := range []bool{false, true} {
		t.Run(fmt.Sprint(fail), func(t *testing.T) {
			e := testExtractor(t)
			calls := 0
			e.config.OCR = ocrFunc(func(context.Context, string) (string, error) {
				calls++
				if fail {
					return "", errors.New("model missing")
				}
				return "IMAGE_KEYWORD", nil
			})
			input := zipFixture(t, "docx", map[string]string{
				"word/document.xml":            `<w:document xmlns:w="word" xmlns:a="drawing" xmlns:r="rels"><w:body><w:p><w:del/><w:r><w:t>BEFORE 中文</w:t><w:br/><a:blip r:embed="rId1"/><w:t>MIDDLE</w:t><a:blip r:embed="rId1"/><w:t>AFTER &amp; END</w:t></w:r></w:p></w:body></w:document>`,
				"word/_rels/document.xml.rels": `<Relationships><Relationship Id="rId1" Target="media/image.png"/></Relationships>`,
				"word/media/image.png":         "controlled image bytes",
			})
			r, err := e.ExtractText(context.Background(), input, Options{})
			if fail {
				if err == nil || r.Complete || !strings.Contains(r.Text, "AFTER & END") || r.ErrorCode != "ocr_failed" {
					t.Fatalf("%+v %v", r, err)
				}
				return
			}
			if err != nil || calls != 1 {
				t.Fatalf("calls %d: %+v %v", calls, r, err)
			}
			offset := 0
			for _, word := range []string{"BEFORE 中文", "IMAGE_KEYWORD", "MIDDLE", "IMAGE_KEYWORD", "AFTER & END"} {
				n := strings.Index(r.Text[offset:], word)
				if n < 0 {
					t.Fatalf("order %q in %q", word, r.Text)
				}
				offset += n + len(word)
			}
		})
	}
}

// A self-contained PDF with Helvetica text on page 1 and blank later pages.
func pdfFixture(t *testing.T, pages int, text bool) string {
	t.Helper()
	objects := []string{"<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"}
	var kids []string
	for i := 0; i < pages; i++ {
		pageID := len(objects) + 1
		contentID := pageID + 1
		kids = append(kids, fmt.Sprintf("%d 0 R", pageID))
		stream := ""
		if i == 0 && text {
			stream = "BT /F1 12 Tf 20 100 Td (TEXT_LAYER_KEYWORD) Tj ET"
		}
		objects = append(objects, fmt.Sprintf("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 150] /Resources << /Font << /F1 3 0 R >> >> /Contents %d 0 R >>", contentID), fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(stream), stream))
	}
	objects[1] = fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), pages)
	var b bytes.Buffer
	b.WriteString("%PDF-1.4\n")
	offsets := []int{0}
	for i, obj := range objects {
		offsets = append(offsets, b.Len())
		fmt.Fprintf(&b, "%d 0 obj\n%s\nendobj\n", i+1, obj)
	}
	xref := b.Len()
	fmt.Fprintf(&b, "xref\n0 %d\n0000000000 65535 f \n", len(offsets))
	for _, offset := range offsets[1:] {
		fmt.Fprintf(&b, "%010d 00000 n \n", offset)
	}
	fmt.Fprintf(&b, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xref)
	path := filepath.Join(t.TempDir(), "fixture.pdf")
	if err := os.WriteFile(path, b.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	return path
}
func TestMixedPDFAndOCRPageLimit(t *testing.T) {
	e := testExtractor(t)
	calls := 0
	e.config.OCR = ocrFunc(func(_ context.Context, path string) (string, error) {
		calls++
		data, err := os.ReadFile(path)
		if err != nil || !bytes.HasPrefix(data, []byte("\x89PNG")) {
			t.Fatal("PDF render missing")
		}
		return "SCANNED_KEYWORD", nil
	})
	r, err := e.ExtractText(context.Background(), pdfFixture(t, 2, true), Options{})
	if err != nil || calls != 1 || !strings.Contains(r.Text, "TEXT_LAYER_KEYWORD") || !strings.Contains(r.Text, "SCANNED_KEYWORD") {
		t.Fatalf("calls %d: %+v %v", calls, r, err)
	}
	calls = 0
	r, err = e.ExtractText(context.Background(), pdfFixture(t, 3, false), Options{MaxOCRPages: 1})
	if err != nil || !r.Complete || !r.Truncated || calls != 1 {
		t.Fatalf("limit calls %d: %+v %v", calls, r, err)
	}
}
func TestUTF8TruncationAndCorruptPDF(t *testing.T) {
	e := testExtractor(t)
	p := zipFixture(t, "docxf", map[string]string{"word/document.xml": `<document><p><t>中文ABC</t></p></document>`})
	r, err := e.ExtractText(context.Background(), p, Options{MaxBytes: 4})
	if err != nil || r.Text != "中" || !r.Truncated || !utf8.ValidString(r.Text) {
		t.Fatalf("%+v %v", r, err)
	}
	corrupt := filepath.Join(t.TempDir(), "broken.pdf")
	_ = os.WriteFile(corrupt, []byte("broken"), 0600)
	r, err = e.ExtractText(context.Background(), corrupt, Options{})
	if err == nil || r.Complete || r.ErrorCode != "parse_error" {
		t.Fatalf("%+v %v", r, err)
	}
}
func TestOCRCancellationCleansWorkAndNextRequestWorks(t *testing.T) {
	e := testExtractor(t)
	e.config.TempDir = t.TempDir()
	e.config.OCR = ocrFunc(func(ctx context.Context, _ string) (string, error) { <-ctx.Done(); return "", ctx.Err() })
	p := filepath.Join(t.TempDir(), "image.png")
	_ = os.WriteFile(p, []byte("fixture"), 0600)
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := e.ExtractText(ctx, p, Options{}); err == nil {
		t.Fatal("canceled OCR succeeded")
	}
	entries, err := os.ReadDir(e.config.TempDir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("work leaked: %v %v", entries, err)
	}
	e.config.OCR = ocrFunc(func(context.Context, string) (string, error) { return "", nil })
	r, err := e.ExtractText(context.Background(), p, Options{})
	if err != nil || !r.Complete || strings.TrimSpace(r.Text) != "" {
		t.Fatalf("empty success: %+v %v", r, err)
	}
}
func TestXPSAttributeEntitiesAndPageOrder(t *testing.T) {
	e := testExtractor(t)
	for _, ext := range []string{"xps", "oxps"} {
		t.Run(ext, func(t *testing.T) {
			p := zipFixture(t, ext, map[string]string{
				"FixedDocSeq.fdseq":  `<FixedDocumentSequence><DocumentReference Source="Docs/Doc.fdoc"/></FixedDocumentSequence>`,
				"Docs/Doc.fdoc":      `<FixedDocument><PageContent Source="Pages/2.fpage"/><PageContent Source="Pages/1.fpage"/></FixedDocument>`,
				"Docs/Pages/2.fpage": `<FixedPage><Glyphs UnicodeString="FIRST 中文 &amp; &#65;"/></FixedPage>`,
				"Docs/Pages/1.fpage": `<FixedPage><Glyphs UnicodeString="SECOND"/></FixedPage>`,
			})
			r, err := e.ExtractText(context.Background(), p, Options{})
			if err != nil || r.Text != "FIRST 中文 & A\nSECOND\n" {
				t.Fatalf("%+v %v", r, err)
			}
		})
	}
}
func TestXLSBAndCADFixtures(t *testing.T) {
	e := testExtractor(t)
	for _, p := range []string{"testdata/Simple.xlsb", "testdata/text-layer.djvu", "testdata/sample_AC1015.dwg", "../apps/demo/public/samples/filens-cafe.dxf"} {
		r, err := e.ExtractText(context.Background(), p, Options{})
		if err != nil || strings.TrimSpace(r.Text) == "" {
			t.Fatalf("%s: %+v %v", p, r, err)
		}
		t.Logf("%s: %.300s", p, r.Text)
	}
}

func TestPDFJPEGRender(t *testing.T) {
	e := testExtractor(t)
	img := image.NewRGBA(image.Rect(0, 0, 160, 160))
	draw.Draw(img, img.Bounds(), &image.Uniform{color.White}, image.Point{}, draw.Src)
	var jpg bytes.Buffer
	if err := jpeg.Encode(&jpg, img, nil); err != nil {
		t.Fatal(err)
	}
	stream := []byte("q 160 0 0 160 0 0 cm /Im1 Do Q")
	objects := []string{
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 160 160] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>",
		fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(stream), stream),
		fmt.Sprintf("<< /Type /XObject /Subtype /Image /Width 160 /Height 160 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length %d >>\nstream\n%s\nendstream", jpg.Len(), jpg.Bytes()),
	}
	var pdf bytes.Buffer
	pdf.WriteString("%PDF-1.4\n")
	offsets := []int{0}
	for i, obj := range objects {
		offsets = append(offsets, pdf.Len())
		fmt.Fprintf(&pdf, "%d 0 obj\n%s\nendobj\n", i+1, obj)
	}
	xref := pdf.Len()
	fmt.Fprintf(&pdf, "xref\n0 %d\n0000000000 65535 f \n", len(offsets))
	for _, o := range offsets[1:] {
		fmt.Fprintf(&pdf, "%010d 00000 n \n", o)
	}
	fmt.Fprintf(&pdf, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(offsets), xref)
	path := filepath.Join(t.TempDir(), "scan.pdf")
	if err := os.WriteFile(path, pdf.Bytes(), 0600); err != nil {
		t.Fatal(err)
	}
	r, err := e.ExtractText(context.Background(), path, Options{})
	if err != nil || !strings.Contains(r.Text, "OCR injected 中文") {
		t.Fatalf("%+v %v", r, err)
	}
}

func TestFlatODFEmbeddedOCR(t *testing.T) {
	e := testExtractor(t)
	original, err := os.ReadFile("../examples/go-wazero-converter/fixtures/doc/sample.fodt")
	if err != nil {
		t.Fatal(err)
	}
	xml := strings.Replace(string(original), "<office:document-content", "<office:document-content xmlns:draw=\"urn:oasis:names:tc:opendocument:xmlns:drawing:1.0\"", 1)
	xml = strings.Replace(xml, "</office:text>", "<text:p>IMAGE_BODY<draw:image><office:binary-data>eA==</office:binary-data></draw:image></text:p></office:text>", 1)
	path := filepath.Join(t.TempDir(), "inline.fodt")
	if err = os.WriteFile(path, []byte(xml), 0600); err != nil {
		t.Fatal(err)
	}
	r, err := e.ExtractText(context.Background(), path, Options{})
	if err != nil || !strings.Contains(r.Text, "IMAGE_BODY") || !strings.Contains(r.Text, "OCR injected 中文") || strings.Contains(r.Text, "eA==") {
		t.Fatalf("%+v %v", r, err)
	}
}

func TestPasswordPDFIsTerminalAndOCRMissingIsFailure(t *testing.T) {
	e := testExtractor(t)
	r, err := e.ExtractText(context.Background(), "testdata/password_test123.pdf", Options{})
	if err == nil || r.Complete || r.ErrorCode != "password_required" {
		t.Fatalf("password result %+v %v", r, err)
	}
	e.config.OCR = nil
	path := filepath.Join(t.TempDir(), "image.png")
	_ = os.WriteFile(path, []byte("fixture"), 0600)
	r, err = e.ExtractText(context.Background(), path, Options{})
	if err == nil || r.Complete || r.ErrorCode != "ocr_failed" {
		t.Fatalf("missing provider %+v %v", r, err)
	}
}
